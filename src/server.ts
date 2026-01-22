import { routeAgentRequest, type Schedule } from "agents";

import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
// import { createWorkersAI } from 'workers-ai-provider';
// import { env } from "cloudflare:workers";
// const workersai = createWorkersAI({ binding: env.AI });

// const model = workersai("@cf/meta/llama-2-7b-chat-int8");

import { google } from "@ai-sdk/google";
const model = google("gemini-3-flash-preview");

// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools
      //...this.mcp.getAITools() TODO: enable MCP tools if needed
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const result = streamText({
          system: `You are an AI assistant that helps users with their resume/curriculum vitae. Use the available tools to provide accurate and helpful information. Furthermore, you would want to read and process user uploaded files, since they might be resumes, CVs, or other related documents. The users also might provide job listinsgs, you would want to help them tailor their resumes/CVs to better fit the job requirements.
          
          When the user uploads files, make sure to read and process them carefully. Extract relevant information from resumes/CVs and use that to assist the user in improving their documents. If the user provides job listings, analyze the requirements and suggest modifications to the resumes/CVs to better align with the job criteria. If necessary, you should suggest adding new sections, rephrasing content, or highlighting specific skills and experiences that match the job description.
          You are encouraged to ask the user questions in order to help achieve their goals.`,

          messages: await convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(10)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("AI Resume Assistant is running.");
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
