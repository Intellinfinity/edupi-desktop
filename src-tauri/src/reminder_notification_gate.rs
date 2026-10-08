//! Fixed-loopback, bounded final proof transport. No redirects, caller URLs, or credentials in JSON.
use std::{
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddr, TcpStream},
    time::{Duration, Instant},
};

const MAX_HEADERS: usize = 4096;
const DEADLINE: Duration = Duration::from_millis(1500);
const PROOF_PATH: &str = "/api/edupi/reminders/native-send";

#[derive(Debug, PartialEq)]
pub(crate) enum ProofResult {
    Current(String),
    Changed,
    Unavailable,
}

fn hex_identity(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

pub(crate) fn valid_uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
        && matches!(value.as_bytes()[14].to_ascii_lowercase(), b'1'..=b'8')
        && matches!(
            value.as_bytes()[19].to_ascii_lowercase(),
            b'8' | b'9' | b'a' | b'b'
        )
}

fn response_proof(response: &[u8], instance: &str, nonce: &str) -> ProofResult {
    let Ok(text) = std::str::from_utf8(response) else {
        return ProofResult::Unavailable;
    };
    let Some((headers, body)) = text.split_once("\r\n\r\n") else {
        return ProofResult::Unavailable;
    };
    let mut lines = headers.split("\r\n");
    let Some(status) = lines.next() else {
        return ProofResult::Unavailable;
    };
    if status.starts_with("HTTP/1.1 409 ") || status.starts_with("HTTP/1.0 409 ") {
        return ProofResult::Changed;
    }
    if !status.starts_with("HTTP/1.1 204 ") && !status.starts_with("HTTP/1.0 204 ") {
        return ProofResult::Unavailable;
    }
    if !body.is_empty() {
        return ProofResult::Unavailable;
    }
    let mut found_instance = None;
    let mut found_nonce = None;
    let mut found_dispatch = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else {
            return ProofResult::Unavailable;
        };
        let value = value.trim();
        if name.eq_ignore_ascii_case("transfer-encoding")
            || name.eq_ignore_ascii_case("content-length") && value != "0"
        {
            return ProofResult::Unavailable;
        }
        if name.eq_ignore_ascii_case("x-pi-desktop-instance") {
            if found_instance.replace(value).is_some() {
                return ProofResult::Unavailable;
            }
        }
        if name.eq_ignore_ascii_case("x-pi-reminder-proof-nonce") {
            if found_nonce.replace(value).is_some() {
                return ProofResult::Unavailable;
            }
        }
        if name.eq_ignore_ascii_case("x-pi-reminder-dispatch-id") {
            if found_dispatch.replace(value).is_some() {
                return ProofResult::Unavailable;
            }
        }
    }
    if found_instance == Some(instance)
        && found_nonce == Some(nonce)
        && found_dispatch.is_some_and(valid_uuid)
    {
        ProofResult::Current(found_dispatch.unwrap().to_string())
    } else {
        ProofResult::Unavailable
    }
}

pub(crate) fn validate(
    port: u16,
    token: &str,
    instance: &str,
    nonce: &str,
    body: &[u8],
) -> ProofResult {
    if port == 0
        || token.len() < 32
        || token.len() > 256
        || !token.bytes().all(|byte| (33..=126).contains(&byte))
        || !hex_identity(instance)
        || !hex_identity(nonce)
        || body.is_empty()
        || body.len() > 4096
    {
        return ProofResult::Unavailable;
    }
    let deadline = Instant::now() + DEADLINE;
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(300)) else {
        return ProofResult::Unavailable;
    };
    let request = format!("POST {PROOF_PATH} HTTP/1.1\r\nHost: {address}\r\nx-pi-desktop-token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len());
    let bytes = [request.as_bytes(), body].concat();
    let mut offset = 0;
    while offset < bytes.len() {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            return ProofResult::Unavailable;
        };
        if stream.set_write_timeout(Some(remaining)).is_err() {
            return ProofResult::Unavailable;
        }
        match stream.write(&bytes[offset..]) {
            Ok(0) | Err(_) => return ProofResult::Unavailable,
            Ok(count) => offset += count,
        }
    }
    let mut response = Vec::with_capacity(1024);
    loop {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            return ProofResult::Unavailable;
        };
        if stream.set_read_timeout(Some(remaining)).is_err() {
            return ProofResult::Unavailable;
        }
        let mut chunk = [0_u8; 256];
        let Ok(count) = stream.read(&mut chunk) else {
            return ProofResult::Unavailable;
        };
        if count == 0 {
            return response_proof(&response, instance, nonce);
        }
        response.extend_from_slice(&chunk[..count]);
        if response.len() > MAX_HEADERS {
            return ProofResult::Unavailable;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{net::TcpListener, sync::mpsc, thread};
    const TOKEN: &str = "synthetic-native-proof-token-123456789";
    const DISPATCH: &str = "10000000-0000-4000-8000-000000000001";
    fn identities() -> (String, String) {
        ("b".repeat(64), "a".repeat(64))
    }
    fn response(instance: &str, nonce: &str) -> Vec<u8> {
        format!("HTTP/1.1 204 No Content\r\nx-pi-desktop-instance: {instance}\r\nx-pi-reminder-proof-nonce: {nonce}\r\nx-pi-reminder-dispatch-id:{DISPATCH}\r\nContent-Length: 0\r\n\r\n").into_bytes()
    }
    fn fixture(
        reply: Vec<u8>,
        hold: bool,
    ) -> (
        u16,
        mpsc::Receiver<Vec<u8>>,
        mpsc::Sender<()>,
        thread::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let (captured, capture) = mpsc::channel();
        let (release, wait) = mpsc::channel();
        let worker = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            loop {
                let mut chunk = [0_u8; 512];
                let count = socket.read(&mut chunk).unwrap();
                if count == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..count]);
                let raw = String::from_utf8_lossy(&request);
                if let Some((headers, body)) = raw.split_once("\r\n\r\n") {
                    let length = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("Content-Length: "))
                        .unwrap()
                        .parse::<usize>()
                        .unwrap();
                    if body.len() >= length {
                        break;
                    }
                }
            }
            let _ = captured.send(request);
            if hold {
                let _ = wait.recv();
            }
            let _ = socket.write_all(&reply);
        });
        (port, capture, release, worker)
    }
    #[test]
    fn actual_loopback_current_proof_uses_only_fixed_path_private_header_and_claim_body() {
        let (instance, nonce) = identities();
        let (port, request, _, worker) = fixture(response(&instance, &nonce), false);
        let body = format!(
            r#"{{"version":1,"nonce":"{nonce}","claims":[{{"id":"synthetic","attemptId":"10000000-0000-4000-8000-000000000002","attemptedAt":"2026-10-08T00:00:00Z"}}]}}"#
        );
        assert_eq!(
            validate(port, TOKEN, &instance, &nonce, body.as_bytes()),
            ProofResult::Current(DISPATCH.into())
        );
        let captured = String::from_utf8(request.recv().unwrap()).unwrap();
        assert!(captured
            .starts_with("POST /api/edupi/reminders/native-send HTTP/1.1\r\nHost: 127.0.0.1:"));
        assert!(captured.contains("x-pi-desktop-token: synthetic-native-proof-token-123456789"));
        assert!(!captured.split_once("\r\n\r\n").unwrap().1.contains(TOKEN));
        worker.join().unwrap();
    }
    #[test]
    fn actual_loopback_wrong_instance_nonce_replay_redirect_corruption_and_oversize_never_deliver()
    {
        let (instance, nonce) = identities();
        let replies = [
            response(&"c".repeat(64), &nonce),
            response(&instance, &"c".repeat(64)),
            b"HTTP/1.1 302 Found\r\nLocation: https://foreign.example/\r\n\r\n".to_vec(),
            [
                b"HTTP/1.1 204 No Content\r\ninvalid:".as_slice(),
                &[0x80],
                b"\r\n\r\n",
            ]
            .concat(),
            format!(
                "HTTP/1.1 204 No Content\r\nx-padding:{}\r\n\r\n",
                "x".repeat(4096)
            )
            .into_bytes(),
            [response(&instance, &nonce), b"unexpected-body".to_vec()].concat(),
        ];
        for reply in replies {
            let (port, _, _, worker) = fixture(reply, false);
            let mut delivered = false;
            if matches!(
                validate(port, TOKEN, &instance, &nonce, b"{}"),
                ProofResult::Current(_)
            ) {
                delivered = true;
            }
            assert!(!delivered);
            worker.join().unwrap();
        }
        let old_proof = response(&instance, &nonce);
        let (port, _, _, worker) = fixture(old_proof, false);
        assert_ne!(
            validate(port, TOKEN, &instance, &"d".repeat(64), b"{}"),
            ProofResult::Current(DISPATCH.into())
        );
        worker.join().unwrap();
    }
    #[test]
    fn actual_loopback_deadline_is_total_and_never_turns_a_late_positive_into_delivery() {
        let (instance, nonce) = identities();
        let (port, captured, release, worker) = fixture(response(&instance, &nonce), true);
        let timer = Instant::now();
        assert_eq!(
            validate(port, TOKEN, &instance, &nonce, b"{}"),
            ProofResult::Unavailable
        );
        assert!(timer.elapsed() < Duration::from_secs(3));
        captured.recv().unwrap();
        release.send(()).unwrap();
        worker.join().unwrap();
    }
    #[test]
    fn denied_or_unavailable_proof_is_not_a_send_failure_and_malformed_positive_headers_fail_closed(
    ) {
        let (instance, nonce) = identities();
        assert_eq!(
            response_proof(b"HTTP/1.1 409 Conflict\r\n\r\n", &instance, &nonce),
            ProofResult::Changed
        );
        assert_eq!(
            response_proof(b"HTTP/1.1 503 Unavailable\r\n\r\n", &instance, &nonce),
            ProofResult::Unavailable
        );
        let duplicate = format!("HTTP/1.1 204 No Content\r\nx-pi-desktop-instance:{instance}\r\nx-pi-desktop-instance:{instance}\r\nx-pi-reminder-proof-nonce:{nonce}\r\n\r\n");
        assert_eq!(
            response_proof(duplicate.as_bytes(), &instance, &nonce),
            ProofResult::Unavailable
        );
        assert_eq!(
            validate(0, TOKEN, &instance, &nonce, b"{}"),
            ProofResult::Unavailable
        );
        assert_eq!(
            validate(1, "injected\r\nheader", &instance, &nonce, b"{}"),
            ProofResult::Unavailable
        );
    }

    #[test]
    fn native_send_never_accepts_a_readonly_proof_without_a_dispatch_uuid() {
        let (instance, nonce) = identities();
        let readonly = format!("HTTP/1.1 204 No Content\r\nx-pi-desktop-instance:{instance}\r\nx-pi-reminder-proof-nonce:{nonce}\r\n\r\n");
        assert_eq!(
            response_proof(readonly.as_bytes(), &instance, &nonce),
            ProofResult::Unavailable
        );
    }

    #[test]
    fn native_send_transport_requests_the_atomic_send_path_not_readonly_proof() {
        let (instance, nonce) = identities();
        let reply = format!("HTTP/1.1 204 No Content\r\nx-pi-desktop-instance:{instance}\r\nx-pi-reminder-proof-nonce:{nonce}\r\nx-pi-reminder-dispatch-id:10000000-0000-4000-8000-000000000001\r\n\r\n");
        let (port, captured, _, worker) = fixture(reply.into_bytes(), false);
        let _ = validate(port, TOKEN, &instance, &nonce, b"{}");
        assert!(String::from_utf8(captured.recv().unwrap())
            .unwrap()
            .starts_with("POST /api/edupi/reminders/native-send HTTP/1.1\r\n"));
        worker.join().unwrap();
    }

    #[test]
    fn dispatch_permit_requires_exactly_one_real_uuid() {
        let (instance, nonce) = identities();
        for dispatch in ["not-uuid", "00000000-0000-0000-0000-000000000000", "10000000-0000-4000-8000-000000000001\r\nx-pi-reminder-dispatch-id:10000000-0000-4000-8000-000000000002"] {
            let reply = format!("HTTP/1.1 204 No Content\r\nx-pi-desktop-instance:{instance}\r\nx-pi-reminder-proof-nonce:{nonce}\r\nx-pi-reminder-dispatch-id:{dispatch}\r\n\r\n");
            assert_eq!(response_proof(reply.as_bytes(), &instance, &nonce), ProofResult::Unavailable);
        }
    }

    #[test]
    fn lost_begin_response_never_authorizes_os_send_and_remains_unknown() {
        let (instance, nonce) = identities();
        let (port, captured, _, worker) = fixture(Vec::new(), false);
        assert_eq!(
            validate(port, TOKEN, &instance, &nonce, b"{}"),
            ProofResult::Unavailable
        );
        assert!(
            !captured.recv().unwrap().is_empty(),
            "the server received a request and may already have committed its marker"
        );
        worker.join().unwrap();
    }
}
