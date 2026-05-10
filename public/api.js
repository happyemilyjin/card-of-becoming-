/** Legacy deck JSON: strip repeated style sentences from a full per-card description. */
function extractVisualEssence(description) {
  const sentences = description.split(". ");
  const vivid = sentences
    .filter(
      (s) =>
        !s.includes("Portrait card format") &&
        !s.includes("Thick ornate metallic") &&
        !s.includes("Card title elegantly") &&
        !s.includes("hyper-detailed, gothic-surrealist")
    )
    .slice(0, 3)
    .join(". ");
  return vivid;
}

function motifForCard(c) {
  if (Array.isArray(c.keywords) && c.keywords.length) {
    return `${c.concept}: ${c.keywords.join(", ")}`;
  }
  if (c.scene && String(c.scene).trim()) return c.scene.trim();
  if (c.description) return extractVisualEssence(c.description);
  return c.concept;
}

const FRAME_REFERENCE_STYLE =
  "Use the provided transparent tarot frame image as the exact visual reference and base composition. Preserve its ornate gold border, side ornaments, arched top tracery, and bottom title cartouche as the card format. Fill the transparent central opening with the new symbolic illustration while keeping the full vertical tarot layout.";

function buildPrompt(cardInfos, sharedStyle, cardTitle) {
  const conceptList = cardInfos.map((c) => c.concept).join(", ");
  const visualFragments = cardInfos.map(motifForCard).join(" | ");
  const titleLine = cardTitle
    ? `This oracle card is titled "${cardTitle}". Render that exact title inside the bottom cartouche in elegant uppercase serif lettering that matches the frame. `
    : "";

  if (sharedStyle) {
    return (
      `One unified tarot-style oracle card combining four archetypes: ${conceptList}. ` +
      titleLine +
      `${FRAME_REFERENCE_STYLE} ` +
      `${sharedStyle} ` +
      `Integrate these motifs into a single coherent vertical portrait composition: ${visualFragments}. ` +
      `Masterpiece quality, single scene, no collage, no multiple separate cards.`
    );
  }

  return (
    `A single hyper-detailed, gothic-surrealist oracle card illustration ` +
    `that fuses the essences of four archetypes into one unified vision: ${conceptList}. ` +
    titleLine +
    `${FRAME_REFERENCE_STYLE} ` +
    `Visual elements drawn from: ${visualFragments}. ` +
    `Melancholic, mysterious, highly textural, cinematic, masterpiece quality.`
  );
}

async function generatePersonalCard(cardInfos, apiKey, sharedStyle = null, cardTitle = "") {
  const prompt = buildPrompt(cardInfos, sharedStyle, cardTitle);
  console.log("Prompt:", prompt);

  let rawBlob;
  try {
    const frameReference = await fetchFrameReferenceFile();
    const formData = new FormData();
    formData.append("model", "gpt-image-1");
    formData.append("quality", "low");
    formData.append(
      "prompt",
      `${prompt} Keep the supplied frame structure visible in the final image. ` +
        `Avoid blurry details, watermarks, collage layouts, multiple separate cards, ` +
        `photorealism, 3D render style, deformed anatomy, square framing, wide framing, ` +
        `landscape composition, cropped frame edges, or modern sans-serif typography.`
    );
    formData.append("size", "1024x1536");
    formData.append("image", frameReference);

    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      let message = `${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.json();
        message = errorBody?.error?.message || message;
      } catch (_) {
        // Keep the HTTP status when OpenAI returns a non-JSON error body.
      }
      throw new Error(message);
    }

    const data = await response.json();
    const base64 = data?.data?.[0]?.b64_json;
    if (!base64) {
      throw new Error("OpenAI did not return image data.");
    }

    rawBlob = base64ToBlob(base64, "image/png");
  } catch (err) {
    const message = err && err.message ? String(err.message) : "Unknown generation error";
    throw new Error(`OpenAI image generation failed: ${message}`);
  }

  return rawBlob;
}

async function fetchFrameReferenceFile() {
  const response = await fetch("assets/fate_card_frame.png");
  if (!response.ok) {
    throw new Error("Could not load fate card frame reference.");
  }
  const blob = await response.blob();
  return new File([blob], "fate_card_frame.png", { type: "image/png" });
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

window.generatePersonalCard = generatePersonalCard;
