import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import "dotenv/config";
import process from "node:process";
import * as z from "zod/v4";

const server = new McpServer({
  name: "document-mcp-server",
  version: "1.0.0",
});
// ==========================================
// TOOL 1: Count words in a document
// ==========================================

const API_BASE_URL = process.env.MCP_API_BASE_URL;
const API_TOKEN = process.env.MCP_API_TOKEN;
const DOCUMENTS_PATH =
  process.env.MCP_DOCUMENTS_PATH ?? "/api/conversions";
const FORMATS_PATH =
  process.env.MCP_FORMATS_PATH ?? "/api/conversions/operations";

if (!API_BASE_URL || !API_TOKEN) {
  console.error("Error: MCP_API_BASE_URL and MCP_API_TOKEN environment variables must be set.");
  process.exit(1);
}

const baseUrl = API_BASE_URL.replace(/\/+$/, "");

async function laravelRequest(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: unknown;
  } = {},
): Promise<unknown> {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const response = await fetch(`${baseUrl}${normalizedPath}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${API_TOKEN}`,
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
    signal: AbortSignal.timeout(15_000),
  });

  const responseText = await response.text();

  let data: unknown = responseText;

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      // Preserve non-JSON responses for useful diagnostics.
    }
  }

  if (!response.ok) {
    throw new Error(
      `Laravel API returned HTTP ${response.status}: ${
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      }`,
    );
  }

  return data;
}

function toolSuccess(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toolFailure(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred.",
      },
    ],
  };
}

// TOOL 1: Discover valid operations before choosing one.
server.registerTool(
  "list_supported_formats",
  {
    description:
      "Retrieve the conversion operations and file formats currently supported by the Laravel document-converter API. Use this tool when you need to know which conversions are available or when you need the exact operation identifier before starting a conversion. Do not invent operation names or assume that every input format can be converted to every output format. The response is authoritative for the configured API.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const data = await laravelRequest(FORMATS_PATH);
      return toolSuccess(data);
    } catch (error) {
      return toolFailure(error);
    }
  },
);

// TOOL 2: Start an asynchronous conversion.
server.registerTool(
  "convert_document",
  {
    description:
      "Start a conversion for an existing document managed by the Laravel document-converter API. Provide the document_id of a document that has already been uploaded and the exact operation identifier returned by list_supported_formats. This tool requests that Laravel start the conversion; it does not itself convert the file or guarantee completion. On success, return the API response, including any document ID, job ID, or status supplied by Laravel. Use get_conversion_status to check progress. Never claim the conversion completed merely because it was accepted.",
    inputSchema: z.object({
      document_id: z
        .string()
        .min(1)
        .describe(
          "ID of an existing uploaded document in the Laravel API.",
        ),
      operation: z
        .string()
        .min(1)
        .describe(
          "Exact conversion operation identifier returned by list_supported_formats; do not guess it.",
        ),
    }),
  },
  async ({ document_id, operation }) => {
    try {
      const path =
        `${DOCUMENTS_PATH}/${encodeURIComponent(document_id)}/process`;

      const data = await laravelRequest(path, {
        method: "POST",
        body: { operation },
      });

      return toolSuccess(data);
    } catch (error) {
      return toolFailure(error);
    }
  },
);

// TOOL 3: Check a document's conversion status.
server.registerTool(
  "get_conversion_status",
  {
    description:
      "Retrieve the latest processing status for an existing document in the Laravel document-converter API. Provide the document_id returned by the upload or conversion workflow. Use this after convert_document to determine whether processing is pending, processing, completed, or failed, if those are the statuses returned by the API. Report the actual returned status rather than assuming the job has finished. This tool reads status; it does not start, retry, or cancel a conversion.",
    inputSchema: z.object({
      document_id: z
        .string()
        .min(1)
        .describe(
          "ID of the existing document whose conversion status should be checked.",
        ),
    }),
  },
  async ({ document_id }) => {
    try {
      const path =
        `${DOCUMENTS_PATH}/${encodeURIComponent(document_id)}/status`;

      const data = await laravelRequest(path);
      return toolSuccess(data);
    } catch (error) {
      return toolFailure(error);
    }
  },
);
server.registerTool(
  "count_words",
  {
    description: "read the number in supplied document text.",
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
      operator: z
        .enum(["add", "subtract", "multiply", "divide"])
        .describe("The operation to perform"),
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
  },
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
    const sentences =
      text
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
