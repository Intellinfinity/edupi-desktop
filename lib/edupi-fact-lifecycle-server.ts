import type { EducationContract, EducationFact } from "./edupi-education-contract";
import type { DeletedEducationFact, FactMutationInput, FactMutationReceipt } from "./edupi-fact-lifecycle-model";

function visibleFact(data: EducationContract, factId: string): EducationFact | null {
  const matches = [...(data.factSpine?.acceptedFacts || []), ...(data.factSpine?.factCandidates || [])].filter((fact) => fact.id === factId);
  return matches.length === 1 ? matches[0] : null;
}

export function verifiesFactMutation(data: EducationContract, receipt: FactMutationReceipt, input: FactMutationInput): boolean {
  const result = visibleFact(data, receipt.resultFactId);
  const original = visibleFact(data, receipt.factId);
  if (input.action === "review") {
    if (input.decision === "reject") return result === null;
    const status = input.decision === "accept" ? "accepted" : "held";
    const supersededGone = input.supersedesFactId === null || visibleFact(data, input.supersedesFactId) === null;
    return receipt.supersededFactId === input.supersedesFactId && supersededGone
      && Boolean(result && result.id === receipt.factId && result.status === status && result.revision === receipt.revision);
  }
  if (input.action === "modify") return Boolean(result && result.status === "accepted" && result.revision === receipt.revision && result.value === input.replacementValue && (receipt.resultFactId === receipt.factId || original === null));
  if (input.action === "delete") return original === null && receipt.status === "deleted";
  const supersededGone = input.supersedesFactId === null || visibleFact(data, input.supersedesFactId) === null;
  if (receipt.supersededFactId !== input.supersedesFactId || !supersededGone) return false;
  if (receipt.status === "accepted" || receipt.status === "candidate" || receipt.status === "pending_review" || receipt.status === "held") {
    return Boolean(result && result.id === receipt.factId && result.status === receipt.status && result.revision === receipt.revision);
  }
  return input.supersedesFactId === null && result === null;
}

export function verifiesDeletedFact(fact: DeletedEducationFact | null, receipt: FactMutationReceipt): boolean {
  return Boolean(fact && fact.factId === receipt.factId && fact.revision === receipt.revision && fact.status === "deleted");
}
