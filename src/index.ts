
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const server = new McpServer({
  name: "document-mcp-server",
  version: "1.0.0",
});

// ==========================================
// TOOL 1: Count words in a document
// ==========================================
server.registerTool(
  "count_words",
  {
    description: "Count the words in supplied document text.",
    inputSchema: z.object({
      text: z.string().min(1).describe("The document text"),
    }),
  },
  async ({ text }) => {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    return {
      content: [
        {
          type: "text",
          text: `Word count: ${wordCount}`,
        },
      ],
    };
  },
);
server.registerTool(
    "calculate_number",
    {
        description: "Calculate the number of words in the provided text.",
        
        inputSchema: z.object({
            operator: z.enum(["add", "subtract", "multiply", "divide"]).describe("The operation to perform"), 
            firstNumber: z.number().describe("The first number"),
            secondNumber: z.number().describe("The second number"),
        }),
    },
    async ({ firstNumber, secondNumber, operator }) => {
        let result: number;
        switch (operator) {
            case "add":
                result = firstNumber + secondNumber;
                break;
            case "subtract":
                result = firstNumber - secondNumber;
                break;
            case "multiply":
                result = firstNumber * secondNumber;
                break;
            case "divide":
                if (secondNumber === 0) {
                    throw new Error("Division by zero is not allowed.");
                }
                result = firstNumber / secondNumber;
                break;
            default:
                throw new Error(`Unsupported operator: ${operator}`);
        }
        return {
            content: [
                {
                    type: "text",
                    text: `Result: ${result}`,
                },
            ],
        };
    }    
);

// ==========================================
// TOOL 2: Extract key points
// ==========================================
server.registerTool(
  "extract_key_points",
  {
    description: "Extract up to three leading sentences as key points.",
    inputSchema: z.object({
      text: z.string().min(1).describe("The document text"),
    }),
  },
  async ({ text }) => {
    const sentences = text
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) ?? [];

    const points = sentences.slice(0, 3);

    return {
      content: [
        {
          type: "text",
          text: points.length
            ? points.map((point, i) => `${i + 1}. ${point}`).join("\n")
            : "No key points found.",
        },
      ],
    };
  },
);

// ==========================================
// RESOURCE: Read the document processing guide
// ==========================================
server.registerResource(
  "document-guide",
  "document://guide",
  {
    title: "Document Processing Guide",
    description: "Reference information for processing documents.",
    mimeType: "text/plain",
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: [
          "DOCUMENT PROCESSING GUIDE",
          "",
          "1. Count words using the count_words tool.",
          "2. Extract leading sentences using extract_key_points.",
          "3. Use the review_document prompt to prepare review instructions.",
          "4. Verify extracted information against the original document.",
          "5. The demonstration tools process text only; they do not convert files.",
        ].join("\n"),
      },
    ],
  }),
);

// ==========================================
// PROMPT: Prepare a document review
// ==========================================
server.registerPrompt(
  "review_document",
  {
    title: "Review Document",
    description: "Prepare instructions to review a document this testing.",
    argsSchema: z.object({
      documentText: z.string().min(1),
      focus: z.string().optional(),
    }),
  },
  ({ documentText, focus }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: [
            "Review the following document.",
            `Focus: ${focus || "clarity, accuracy, and structure"}`,
            "",
            "Identify the main ideas, unclear statements, and possible improvements.",
            "Do not invent facts that are absent from the source.",
            "",
            "DOCUMENT:",
            documentText,
          ].join("\n"),
        },
      },
    ],
  }),
);

// ==========================================
// Start the MCP server over stdio
// ==========================================
async function main() {
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // stdout is reserved for MCP protocol messages.
  console.error("Document MCP server connected over stdio.");
}

main().catch((error: unknown) => {
  console.error("Failed to start MCP server:", error);
  process.exitCode = 1;
});
