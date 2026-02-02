document.getElementById("generateBtn").addEventListener("click", async () => {
  const prompt = document.getElementById("prompt").value;
  const outputDiv = document.getElementById("output");

  outputDiv.textContent = "⏳ Generating...";

  try {
    const response = await fetch("http://localhost:5000/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    const data = await response.json();
    if (data.output) {
      outputDiv.textContent = data.output;
    } else {
      outputDiv.textContent = "⚠️ Error: " + (data.error || "Unknown error");
    }
  } catch (err) {
    console.error(err);
    outputDiv.textContent = "❌ Failed to connect to server.";
  }
});
