import type { AIProvider } from "../types";
import { OpenAIProvider } from "./openai-provider";

export function getAIProvider(): AIProvider {
  return new OpenAIProvider();
}

