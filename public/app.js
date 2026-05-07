const form = document.querySelector("#promptForm");
const input = document.querySelector("#promptInput");
const grid = document.querySelector("#jobGrid");
const template = document.querySelector("#jobTemplate");
const formMessage = document.querySelector("#formMessage");
const charCount = document.querySelector("#charCount");
const queueSummary = document.querySelector("#queueSummary");
const heroPreview = document.querySelector("#heroPreview");
const latestTitle = document.querySelector("#latestTitle");
const refreshButton = document.querySelector("#refreshButton");
const referenceInput = document.querySelector("#referenceInput");
const referenceList = document.querySelector("#referenceList");

let jobs = [];
let references = [];

input.addEventListener("input", updateCount);
refreshButton.addEventListener("click", loadJobs);
referenceInput.addEventListener("change", handleReferenceFiles);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = input.value.trim();
  if (!prompt) {
    setMessage("Write a prompt first.", "error");
    return;
  }

  setMessage("Queued.", "ok");
  form.classList.add("is-submitting");

  try {
    const response = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        references: references.map(({ name, dataUrl }) => ({ name, dataUrl }))
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Request failed");
    input.value = "";
    references = [];
    renderReferences();
    updateCount();
    await loadJobs();
  } catch (error) {
    setMessage(error.message, "error");
  } finally {
    form.classList.remove("is-submitting");
  }
});

updateCount();
renderReferences();
await loadJobs();
setInterval(loadJobs, 3000);

async function loadJobs() {
  const response = await fetch("/api/jobs", { cache: "no-store" });
  const payload = await response.json();
  jobs = payload.jobs || [];
  renderJobs();
}

function renderJobs() {
  grid.replaceChildren();

  const counts = jobs.reduce((acc, job) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {});
  queueSummary.textContent = `${counts.queued || 0} queued / ${counts.processing || 0} active / ${counts.done || 0} ready`;

  const latest = jobs.find((job) => job.image_url);
  if (latest) {
    heroPreview.src = latest.image_url;
    latestTitle.textContent = `Image ${latest.id}`;
  }

  if (!jobs.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No images yet.";
    grid.append(empty);
    return;
  }

  for (const job of jobs) {
    const card = template.content.firstElementChild.cloneNode(true);
    const thumb = card.querySelector(".thumb");
    const image = card.querySelector("img");
    const empty = card.querySelector(".thumb-empty");
    const status = card.querySelector(".status-pill");

    card.dataset.status = job.status;
    status.textContent = label(job.status);
    status.classList.add(job.status);
    card.querySelector(".job-id").textContent = `#${job.id}`;
    card.querySelector(".job-prompt").textContent = job.prompt;
    card.querySelector(".job-time").textContent = formatTime(job.updated_at || job.created_at);
    renderJobReferences(card.querySelector(".job-references"), job.references || []);
    card.querySelector(".delete-job").addEventListener("click", async () => {
      await deleteJob(job.id);
    });

    if (job.status === "processing") {
      card.querySelector(".delete-job").disabled = true;
      card.querySelector(".delete-job").title = "Images in progress cannot be deleted";
    }

    if (job.error) {
      card.querySelector(".job-error").textContent = job.error;
    }

    if (job.image_url) {
      image.src = job.image_url;
      image.alt = job.prompt;
      thumb.href = job.image_url;
      empty.remove();
    } else {
      image.remove();
      thumb.removeAttribute("href");
    }

    grid.append(card);
  }
}

async function handleReferenceFiles(event) {
  const files = Array.from(event.target.files || []);
  const selected = files.slice(0, Math.max(0, 6 - references.length));

  for (const file of selected) {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      setMessage(`${file.name} is not a supported image type.`, "error");
      continue;
    }
    if (file.size > 8 * 1024 * 1024) {
      setMessage(`${file.name} is larger than 8MB.`, "error");
      continue;
    }

    const name = uniqueReferenceName(file.name.replace(/\.[^.]+$/, "") || `image${references.length + 1}`);
    references.push({
      id: crypto.randomUUID(),
      name,
      fileName: file.name,
      dataUrl: await readFileAsDataUrl(file)
    });
  }

  referenceInput.value = "";
  renderReferences();
}

function renderReferences() {
  referenceList.replaceChildren();

  if (!references.length) {
    const empty = document.createElement("p");
    empty.className = "reference-empty";
    empty.textContent = "Upload reference images, name them, then mention them in the prompt with @name.";
    referenceList.append(empty);
    return;
  }

  for (const reference of references) {
    const item = document.createElement("div");
    item.className = "reference-item";

    const image = document.createElement("img");
    image.src = reference.dataUrl;
    image.alt = reference.name;

    const nameInput = document.createElement("input");
    nameInput.value = reference.name;
    nameInput.maxLength = 40;
    nameInput.ariaLabel = "Reference image name";

    const mention = document.createElement("button");
    mention.type = "button";
    mention.className = "mention-reference";
    mention.textContent = `@${reference.name}`;
    mention.addEventListener("click", () => insertMention(reference.name));

    nameInput.addEventListener("input", () => {
      reference.name = normalizeReferenceName(nameInput.value);
      mention.textContent = `@${reference.name || "reference"}`;
    });

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-reference";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      references = references.filter((itemReference) => itemReference.id !== reference.id);
      renderReferences();
    });

    const meta = document.createElement("div");
    meta.className = "reference-meta";
    meta.append(nameInput, mention, remove);
    item.append(image, meta);
    referenceList.append(item);
  }
}

function renderJobReferences(container, jobReferences) {
  container.replaceChildren();
  if (!jobReferences.length) return;

  for (const reference of jobReferences) {
    const chip = document.createElement("a");
    chip.className = "reference-chip";
    chip.href = reference.url;
    chip.target = "_blank";
    chip.rel = "noreferrer";
    chip.textContent = `@${reference.name}`;
    container.append(chip);
  }
}

function insertMention(name) {
  const mention = `@${name}`;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^\s/.test(after) ? " " : "";
  input.value = `${before}${prefix}${mention}${suffix}${after}`;
  const cursor = before.length + prefix.length + mention.length + suffix.length;
  input.focus();
  input.setSelectionRange(cursor, cursor);
  updateCount();
}

function readFileAsDataUrl(file) {
  return new Promise((resolvePromise, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolvePromise(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function uniqueReferenceName(baseName) {
  const clean = normalizeReferenceName(baseName) || `image${references.length + 1}`;
  let candidate = clean;
  let suffix = 2;
  while (references.some((reference) => reference.name === candidate)) {
    candidate = `${clean}${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function normalizeReferenceName(value) {
  return value.replace(/[^\w\u4e00-\u9fa5 -]/gu, "").trim().slice(0, 40);
}

async function deleteJob(id) {
  setMessage(`Deleting image ${id}.`, "ok");
  try {
    const response = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Delete failed");
    await loadJobs();
    setMessage(`Deleted image ${id}.`, "ok");
  } catch (error) {
    setMessage(error.message, "error");
  }
}

function updateCount() {
  charCount.textContent = String(input.value.length);
}

function setMessage(message, kind) {
  formMessage.textContent = message;
  formMessage.dataset.kind = kind;
}

function label(status) {
  return {
    queued: "Queued",
    processing: "Processing",
    done: "Done",
    failed: "Failed"
  }[status] || status;
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    day: "numeric"
  }).format(new Date(`${value}Z`));
}
