import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { CohereClient } from "cohere-ai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Initialize Cohere
const cohereClient = new CohereClient({ token: process.env.COHERE_API_KEY });

// ---------- LAW DATA ----------
const laws = {
  harassment: {
    description: "Harassment is unwanted behavior causing fear, discomfort, or threat.",
    ipc_sections: ["354", "509"],
    steps: [
      "Document incidents (photos, texts, emails).",
      "Tell a trusted person or relative.",
      "Contact local police or a women's helpline.",
      "File a First Information Report (FIR).",
    ],
  },
  domestic_violence: {
    description:
      "Domestic violence is abuse by a family member or spouse, physical, emotional, or financial.",
    ipc_sections: ["498A", "304B", "Protection of Women from Domestic Violence Act, 2005"],
    steps: [
      "Seek medical attention if injured.",
      "Approach nearest police station or Protection Officer.",
      "File a Domestic Incident Report (DIR).",
      "Consult a lawyer for protection orders.",
    ],
  },
  theft: {
    description: "Theft is taking someone's property without permission.",
    ipc_sections: ["378", "379"],
    steps: [
      "Call police immediately.",
      "Preserve evidence if possible.",
      "File a formal complaint (FIR) detailing stolen items.",
      "Report stolen documents to issuing authority.",
    ],
  },
  fraud: {
    description: "Fraud is cheating someone to take money or property dishonestly.",
    ipc_sections: ["420", "406"],
    steps: [
      "Collect all proof (bank statements, emails, transactions).",
      "Inform your bank to freeze accounts.",
      "File a complaint with police or EOW.",
      "Seek legal advice to recover losses.",
    ],
  },
  cybercrime: {
    description: "Cybercrime involves hacking, phishing, online scams, or abuse.",
    ipc_sections: ["66", "66C", "66D IT Act"],
    steps: [
      "Take screenshots and save URLs.",
      "Do not delete evidence.",
      "Report to National Cybercrime Reporting Portal.",
      "File a complaint at police/Cyber Cell.",
    ],
  },
  general: {
    description: "General issues. Provide details for accurate guidance.",
    ipc_sections: ["IPC / Relevant Acts determined by facts."],
    steps: ["Provide specific details about your legal issue (what, when, where)."],
  },
};

// ---------- SESSION STORAGE ----------
const sessions = {};

// ---------- HELPERS ----------
function detectIssue(message) {
  message = message.toLowerCase();
  if (/\b(harass|abuse|molest|stalk|eve-teasing)\b/.test(message)) return "harassment";
  if (/\b(husband|wife|home violence|beat|dowry|in-laws)\b/.test(message)) return "domestic_violence";
  if (/\b(stolen|robbed|theft|snatched)\b/.test(message)) return "theft";
  if (/\b(fraud|cheat|scam|money lost|phoney call)\b/.test(message)) return "fraud";
  if (/\b(hack|fake profile|phishing|cyber|online abuse)\b/.test(message)) return "cybercrime";
  return "general";
}

// ---------- EMOTION DETECTION ----------
async function detectEmotion(message) {
  try {
    const response = await cohereClient.classify({
      model: "medium",
      inputs: [message],
      examples: [
        { text: "I am scared of what happened", label: "fear" },
        { text: "I am so angry at them", label: "anger" },
        { text: "I feel sad and lost", label: "sadness" },
        { text: "I am happy it got resolved", label: "joy" },
        { text: "Just talking normally", label: "calm" },
      ],
    });
    return response.classifications[0].prediction;
  } catch (error) {
    console.error("Emotion detection error:", error);
    return "calm"; // fallback
  }
}

// Questions for incident details
const INCIDENT_QUESTIONS = [
  "Can you describe exactly what happened?",
  "Where and when did this incident occur?",
  "Who was involved in this incident?",
  "Do you have any evidence (photos, messages, emails)?",
];

// ---------- CHAT ROUTE ----------
app.post("/chat", async (req, res) => {
  const { message, sessionId = "default" } = req.body;
  if (!message) return res.status(400).json({ error: "Message required" });

  if (!sessions[sessionId]) {
    sessions[sessionId] = {
      chat_history: [],
      stage: 0,
      detectedIssue: null,
      incidentIndex: 0,
      incidentDetails: [],
      legalAdviceGiven: false,
      awaitingCaseHistory: false,
    };
  }

  const session = sessions[sessionId];
  const emotion = await detectEmotion(message);

  // Stage 0: First message -> analyze user
  if (session.stage === 0) {
    session.detectedIssue = detectIssue(message);
    session.stage = 1;
    const detectedIssue = session.detectedIssue;

    const systemPreamble = `
You are LegalEase, empathetic legal assistant.
The user has sent their first message regarding ${detectedIssue.toUpperCase()}.
Analyze their message and respond naturally with empathy.
Ask for clarification or confirmation if needed before proceeding to incident details.
`;

    const response = await cohereClient.chat({
      message,
      preamble: systemPreamble,
      chatHistory: session.chat_history,
      model: "command-r7b-12-2024",
      maxTokens: 200,
      temperature: 0.6,
    });

    const botReply = response.text.trim() + `\n\nCould you please tell me more about the incident in detail?`;
    session.chat_history.push({ role: "user", message });
    session.chat_history.push({ role: "chatbot", message: botReply });

    return res.json({ reply: botReply, emotion });
  }

  // Stage 1: Asking incident details one by one
  if (session.stage === 1) {
    session.incidentDetails.push(message);
    const detectedIssue = session.detectedIssue;

    if (session.incidentIndex < INCIDENT_QUESTIONS.length - 1) {
      session.incidentIndex++;
      const nextQuestion = INCIDENT_QUESTIONS[session.incidentIndex];
      session.chat_history.push({ role: "user", message });
      session.chat_history.push({ role: "chatbot", message: nextQuestion });
      return res.json({ reply: nextQuestion, emotion });
    } else {
      // Collected all incident details -> Stage 2
      session.stage = 2;
      const law = laws[detectedIssue];

      const systemPreamble = `
You are LegalEase, a professional legal assistant.
The user reported an incident about ${detectedIssue.toUpperCase()} with the following details: ${session.incidentDetails.join(
        " "
      )}
Now provide a clear, simple-language summary:
- Explain the relevant laws in simple terms.
- Give step-by-step guidance tailored to this incident.
- Keep the tone empathetic and supportive.
`;

      const response = await cohereClient.chat({
        message,
        preamble: systemPreamble,
        chatHistory: session.chat_history,
        model: "command-r7b-12-2024",
        maxTokens: 300,
        temperature: 0.6,
      });

      const botReply = response.text.trim();

      const legalSummary = `
**Applicable Law (${detectedIssue.toUpperCase()}):** ${law.description}
**Relevant IPC Sections:** ${law.ipc_sections.join(", ")}
**Recommended Steps:**
- ${law.steps.join("\n- ")}
`;

      session.chat_history.push({ role: "user", message });
      session.chat_history.push({ role: "chatbot", message: botReply });

      // Stage 3 prompt for previous cases
      session.awaitingCaseHistory = true;
      const followUp = "Would you like to know about previous similar cases and their outcomes?";
      session.chat_history.push({ role: "chatbot", message: followUp });

      return res.json({ reply: botReply + "\n\n" + followUp, legalSummary, emotion });
    }
  }

  // Stage 3: Handle user response for previous cases
  if (session.awaitingCaseHistory) {
    const detectedIssue = session.detectedIssue;
    const userReply = message.toLowerCase();

    if (userReply.includes("yes")) {
      session.awaitingCaseHistory = false;

      const casePrompt = `
The user wants to know about 2-3 previous legal cases similar to ${detectedIssue.toUpperCase()}.
Provide for each:
- Case Title
- Short Background
- Outcome
- How it relates to the user's situation
Use simple language and make it understandable.
Include real Indian cases if available; otherwise create realistic examples.
`;

      const response = await cohereClient.chat({
        message,
        preamble: casePrompt,
        chatHistory: session.chat_history,
        model: "command-r7b-12-2024",
        maxTokens: 400,
        temperature: 0.6,
      });

      const botReply = response.text.trim();
      session.chat_history.push({ role: "user", message });
      session.chat_history.push({ role: "chatbot", message: botReply });

      return res.json({ reply: botReply, emotion });
    } else {
      // User said no
      session.awaitingCaseHistory = false;
      const botReply = "Alright, we can continue discussing your situation or any other queries you have.";
      session.chat_history.push({ role: "user", message });
      session.chat_history.push({ role: "chatbot", message: botReply });
      return res.json({ reply: botReply, emotion });
    }
  }

  // Stage 2+: Already provided advice, normal chat
  const detectedIssue = session.detectedIssue;
  const systemPreamble = `
You are LegalEase, empathetic legal assistant.
The user already shared the incident about ${detectedIssue.toUpperCase()}.
Continue responding naturally and provide additional legal guidance if needed.
`;

  const response = await cohereClient.chat({
    message,
    preamble: systemPreamble,
    chatHistory: session.chat_history,
    model: "command-r7b-12-2024",
    maxTokens: 250,
    temperature: 0.6,
  });

  const botReply = response.text.trim();
  session.chat_history.push({ role: "user", message });
  session.chat_history.push({ role: "chatbot", message: botReply });

  res.json({ reply: botReply, emotion });
});

app.listen(3000, () => {
  console.log("⚖️ LegalEase running on http://localhost:3000");
});
