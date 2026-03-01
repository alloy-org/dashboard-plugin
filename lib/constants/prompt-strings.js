import { PROVIDER_API_KEY_RETRIEVE_URL } from "constants/provider"

export const NO_MODEL_FOUND_TEXT = `No AI provider has been to setup.\n\n` +
  `For casual-to-intermediate users, we recommend using OpenAI, Anthropic and Gemini, since all offers high quality results. OpenAI can generate images.`;
export const PROVIDER_INVALID_KEY_TEXT = "That doesn't seem to be a valid API key. You can enter one later in the settings for this plugin.";
export const QUESTION_ANSWER_PROMPT = "What would you like to know?"

// --------------------------------------------------------------------------
// API key retrieval instructions for each provider
export const PROVIDER_API_KEY_TEXT = {
  anthropic: `Paste your Anthropic API key in the field below.\n\n` +
    `Your API key should start with "sk-ant-api03-". Get your key here:\n${ PROVIDER_API_KEY_RETRIEVE_URL.anthropic }`,

  deepseek: `Paste your DeepSeek API key in the field below.\n\n` +
    `Sign up for a DeepSeek account and get your API key here:\n${ PROVIDER_API_KEY_RETRIEVE_URL.deepseek }`,

  gemini: `Paste your Gemini API key in the field below.\n\n` +
    `Your API key should start with "AIza". Get your key from Google AI Studio:\n${ PROVIDER_API_KEY_RETRIEVE_URL.gemini }`,

  grok: `Paste your Grok API key in the field below.\n\n` +
    `Your API key should start with "xai-". Get your key from the xAI console:\n${ PROVIDER_API_KEY_RETRIEVE_URL.grok }`,

  openai: `Paste your OpenAI API key in the field below.\n\n` +
    `Your API key should start with "sk-". Get your key here:\n${ PROVIDER_API_KEY_RETRIEVE_URL.openai }`,

  perplexity: `Paste your Perplexity API key in the field below.\n\n` +
    `Your API key should start with "pplx-". Get your key here:\n${ PROVIDER_API_KEY_RETRIEVE_URL.perplexity }`,
}
