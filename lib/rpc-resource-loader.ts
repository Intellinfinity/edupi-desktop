import { DefaultResourceLoader, type ResourceLoader } from "@earendil-works/pi-coding-agent";

type LoaderOptions = ConstructorParameters<typeof DefaultResourceLoader>[0];
export type RpcToolMode = { disabled: boolean };

export function rpcResourceOptions(base: LoaderOptions, mode: RpcToolMode): LoaderOptions {
  return {
    ...base,
    ...(mode.disabled ? {
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalExtensionPaths: [],
      additionalSkillPaths: [],
      additionalPromptTemplatePaths: [],
      additionalThemePaths: [],
      appendSystemPromptOverride: () => [],
    } : {}),
    extensionFactories: [
      ...(mode.disabled ? [] : base.extensionFactories ?? []),
      (pi) => { pi.on("before_agent_start", () => mode.disabled ? { systemPrompt: "" } : undefined); },
    ],
  };
}

/** Keep separate loaders so tool-free reloads never rediscover extensions. */
export function createRpcResourceLoader(initial: ResourceLoader, options: LoaderOptions, mode: RpcToolMode): ResourceLoader {
  let current = initial;
  let enabled = mode.disabled ? undefined : initial;
  let disabled = mode.disabled ? initial : undefined;
  return {
    getExtensions: () => current.getExtensions(),
    getSkills: () => current.getSkills(),
    getPrompts: () => current.getPrompts(),
    getThemes: () => current.getThemes(),
    getAgentsFiles: () => current.getAgentsFiles(),
    getSystemPrompt: () => current.getSystemPrompt(),
    getSystemPromptSource: () => current.getSystemPromptSource(),
    getAppendSystemPrompt: () => current.getAppendSystemPrompt(),
    getAppendSystemPromptSources: () => current.getAppendSystemPromptSources(),
    extendResources: (paths) => { if (!mode.disabled) current.extendResources(paths); },
    async reload(reloadOptions) {
      let next = mode.disabled ? disabled : enabled;
      if (!next) {
        // A loaded SDK loader clears its extension cache on reload. Before the
        // first enable, clear it through the restricted loader without running
        // stale third-party factories. Later reloads reuse each mode's loader.
        if (!mode.disabled) await disabled!.reload(reloadOptions);
        next = new DefaultResourceLoader(rpcResourceOptions(options, mode));
        if (mode.disabled) disabled = next; else enabled = next;
      }
      await next.reload(reloadOptions);
      current = next;
    },
  };
}
