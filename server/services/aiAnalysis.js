const OpenAI = require("openai");

function getAiConfig() {
  const provider = String(process.env.AI_PROVIDER || "openai").trim().toLowerCase();
  return {
    provider,
    apiKey: process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "",
    baseUrl: process.env.AI_BASE_URL || "",
    model: process.env.AI_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    prompt: process.env.AI_ANALYSIS_PROMPT || process.env.OPENAI_ANALYSIS_PROMPT || ""
  };
}

function getConfiguredPrompt() {
  return String(getAiConfig().prompt || "").replaceAll("\\n", "\n").trim();
}

async function analyzeWithOpenAiCompatible({ prompt, images }) {
  const config = getAiConfig();
  if (!config.apiKey) {
    const error = new Error("AI_API_KEY or OPENAI_API_KEY is not configured.");
    error.status = 503;
    error.publicMessage = "AI 분석 API 키가 설정되어 있지 않습니다.";
    throw error;
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {})
  });
  const response = await client.responses.create({
    model: config.model,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        ...images.map((image) => ({
          type: "input_image",
          image_url: image.dataUrl,
          detail: "auto"
        }))
      ]
    }]
  });

  return response.output_text || "분석 결과를 생성하지 못했습니다.";
}

async function analyzeWithOllama({ prompt, images }) {
  const config = getAiConfig();
  const baseUrl = (config.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: config.model || "llava:latest",
      prompt,
      images: images.map((image) => image.base64),
      stream: false
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Ollama analysis request failed.");
    error.status = response.status;
    error.publicMessage = data.error || "로컬 AI 분석 요청에 실패했습니다.";
    throw error;
  }
  return data.response || "분석 결과를 생성하지 못했습니다.";
}

async function analyzeStudyImages({ prompt, images }) {
  const provider = getAiConfig().provider;
  if (provider === "ollama") return analyzeWithOllama({ prompt, images });
  if (provider === "openai" || provider === "openai-compatible") return analyzeWithOpenAiCompatible({ prompt, images });

  const error = new Error(`Unsupported AI provider: ${provider}`);
  error.status = 400;
  error.publicMessage = `지원하지 않는 AI 제공자입니다: ${provider}`;
  throw error;
}

module.exports = {
  analyzeStudyImages,
  getAiConfig,
  getConfiguredPrompt
};
