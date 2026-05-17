const readline = require("readline");

const LM_API_TOKEN = "sk-lm-YicCptt9:Nw4ZrpVJnZV9eTg0zAle";
const LM_BASE_URL = "http://127.0.0.1:1234";
const MODEL = "google/gemma-3-4b";
const DEBUG = false; // set to true to print raw API responses

const history = [];

function extractText(data) {
  if (DEBUG) {
    console.log("\n[DEBUG] Raw response:", JSON.stringify(data, null, 2));
  }

  // OpenAI-compatible format
  if (data.choices && data.choices.length > 0) {
    const choice = data.choices[0];
    if (typeof choice.message?.content === "string") return choice.message.content;
    if (typeof choice.text === "string") return choice.text;
  }

  // LM Studio /api/v1/chat format
  if (data.output) {
    if (typeof data.output === "string") return data.output;
    // output can be an array of content blocks
    if (Array.isArray(data.output)) {
      return data.output
        .map((block) => {
          if (typeof block === "string") return block;
          if (block.text) return block.text;
          if (block.content) return block.content;
          return JSON.stringify(block);
        })
        .join("");
    }
    if (typeof data.output === "object") {
      if (data.output.text) return data.output.text;
      if (data.output.content) return data.output.content;
      return JSON.stringify(data.output);
    }
  }

  if (typeof data.response === "string") return data.response;

  return JSON.stringify(data, null, 2);
}

async function sendMessage(userInput) {
  history.push({ role: "user", content: userInput });

  // Build prompt with full conversation history
  const input =
    history.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n") +
    "\nAssistant:";

  const response = await fetch(`${LM_BASE_URL}/api/v1/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LM_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input, context_length: 8000 }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
  }

  const data = await response.json();
  const reply = extractText(data);

  history.push({ role: "assistant", content: reply });
  return reply;
}

async function checkConnection() {
  const response = await fetch(`${LM_BASE_URL}/api/v1/chat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LM_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input: "hi", context_length: 512 }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${response.statusText}\n${errorText}`);
  }

  return true;
}

async function main() {
  process.stdout.write("Connecting to LM Studio... ");

  try {
    await checkConnection();
    console.log("OK");
    console.log(`Model: ${MODEL}`);
  } catch (error) {
    console.log("FAILED");
    console.error("Error:", error.message);
    console.error(`Make sure LM Studio is running at ${LM_BASE_URL}`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n=== LM STUDIO CHATBOT ===');
  console.log('Type your message. Type "exit" to quit.\n');

  const prompt = () => {
    rl.question("You: ", async (input) => {
      const text = input.trim();

      if (!text) { prompt(); return; }

      if (text.toLowerCase() === "exit") {
        console.log("\nGoodbye.");
        rl.close();
        return;
      }

      try {
        const reply = await sendMessage(text);
        console.log(`Assistant: ${reply}\n`);
      } catch (error) {
        console.error(`Error: ${error.message}\n`);
      }

      prompt();
    });
  };

  prompt();
}

main();
