type ChatMessage = { role: string; content: string };

type ProviderConfig = {
  key: string;
  apiBaseUrl?: string | null;
  chatPath?: string | null;
  extraHeaders?: Record<string, string> | null;
};

type ProviderRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

const coalesce = (value: string | null | undefined, fallback: string): string =>
  value && value.length > 0 ? value : fallback;

export const buildProviderRequest = (params: {
  provider: ProviderConfig;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
}): ProviderRequest => {
  const providerKey = params.provider.key;
  const extraHeaders = params.provider.extraHeaders ?? {};

  if (providerKey === "anthropic") {
    const baseUrl = coalesce(params.provider.apiBaseUrl, "https://api.anthropic.com");
    const chatPath = coalesce(params.provider.chatPath, "/v1/messages");
    const messages = params.messages.map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content
    }));
    return {
      url: `${baseUrl}${chatPath}`,
      method: "POST",
      headers: {
        "x-api-key": params.apiKey,
        "anthropic-version": extraHeaders["anthropic-version"] ?? "2023-06-01",
        "Content-Type": "application/json",
        ...extraHeaders
      },
      body: {
        model: params.model,
        max_tokens: 1024,
        messages
      }
    };
  }

  if (providerKey === "google") {
    const baseUrl = coalesce(
      params.provider.apiBaseUrl,
      "https://generativelanguage.googleapis.com"
    );
    const chatPath = coalesce(
      params.provider.chatPath,
      `/v1beta/models/${params.model}:generateContent`
    );
    const url = `${baseUrl}${chatPath}?key=${encodeURIComponent(params.apiKey)}`;
    const contents = params.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));
    return {
      url,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders
      },
      body: {
        contents
      }
    };
  }

  if (providerKey === "perplexity") {
    const baseUrl = coalesce(params.provider.apiBaseUrl, "https://api.perplexity.ai");
    const chatPath = coalesce(params.provider.chatPath, "/chat/completions");
    return {
      url: `${baseUrl}${chatPath}`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
        ...extraHeaders
      },
      body: {
        model: params.model,
        messages: params.messages
      }
    };
  }

  const baseUrl = coalesce(params.provider.apiBaseUrl, "https://api.openai.com");
  const chatPath = coalesce(params.provider.chatPath, "/v1/chat/completions");
  return {
    url: `${baseUrl}${chatPath}`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders
    },
    body: {
      model: params.model,
      messages: params.messages
    }
  };
};

export const extractUsage = (params: {
  providerKey: string;
  response: any;
}): { promptTokens: number; completionTokens: number; totalTokens: number } => {
  if (params.providerKey === "anthropic") {
    const usage = params.response?.usage ?? {};
    return {
      promptTokens: usage.input_tokens ?? 0,
      completionTokens: usage.output_tokens ?? 0,
      totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
    };
  }
  if (params.providerKey === "google") {
    const usage = params.response?.usageMetadata ?? {};
    return {
      promptTokens: usage.promptTokenCount ?? 0,
      completionTokens: usage.candidatesTokenCount ?? 0,
      totalTokens: usage.totalTokenCount ?? 0
    };
  }
  const usage = params.response?.usage ?? {};
  return {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0
  };
};
