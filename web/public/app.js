const state = {
    sessionId: null,
    parsed: null,
};

const videoUrlInput = document.getElementById("videoUrl");
const btnStart = document.getElementById("btnStart");
const chatLog = document.getElementById("chatLog");
const actionType = document.getElementById("actionType");
const messageInput = document.getElementById("message");
const includeVideoInput = document.getElementById("includeVideo");
const includeVideoWrap = document.getElementById("includeVideoWrap");
const btnSend = document.getElementById("btnSend");
const loadingIndicator = document.getElementById("loadingIndicator");
const sectionsContainer = document.getElementById("sectionsContainer");

function escapeHtml(text) {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function logMessage(type, text) {
    const div = document.createElement("div");
    div.className = `msg ${type}`;
    div.innerHTML = `<pre>${escapeHtml(text)}</pre>`;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function renderMarkdown(markdownText) {
    const safeText = typeof markdownText === "string" ? markdownText : "";

    if (window.marked && typeof window.marked.parse === "function") {
        const html = window.marked.parse(safeText);

        if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
            return window.DOMPurify.sanitize(html);
        }

        return html;
    }

    return `<pre>${escapeHtml(safeText)}</pre>`;
}

function normalizeSectionMarkdown(markdownText) {
    const safeText = typeof markdownText === "string" ? markdownText : "";

    return safeText.replace(
        /^(\s*\*\*[^*\n]+\*\*)([ \t]+)(\S)/,
        "$1\n\n$3"
    );
}

function renderSections(parsed) {
    sectionsContainer.innerHTML = "";

    if (!parsed || !Array.isArray(parsed.itens) || parsed.itens.length === 0) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "Nenhuma seção gerada ainda.";
        sectionsContainer.appendChild(empty);
        return;
    }

    parsed.itens.forEach((item, index) => {
        const card = document.createElement("article");
        card.className = "section-card";

        const title = document.createElement("h3");
        title.textContent = `Seção ${String(index).padStart(2, "0")}`;

        const markdown = document.createElement("div");
        markdown.className = "section-markdown";
        markdown.innerHTML = renderMarkdown(normalizeSectionMarkdown(item));

        card.appendChild(title);
        card.appendChild(markdown);
        sectionsContainer.appendChild(card);
    });

    if (parsed.extra) {
        const card = document.createElement("article");
        card.className = "section-card extra";

        const title = document.createElement("h3");
        title.textContent = "Extra-pauta";

        const markdown = document.createElement("div");
        markdown.className = "section-markdown";
        markdown.innerHTML = renderMarkdown(normalizeSectionMarkdown(parsed.extra));

        card.appendChild(title);
        card.appendChild(markdown);
        sectionsContainer.appendChild(card);
    }
}

function updateActionUi() {
    const isAccept = actionType.value === "accept";
    const isAdjust = actionType.value === "adjust";

    messageInput.disabled = isAccept;
    includeVideoInput.disabled = !isAdjust;
    includeVideoWrap.style.display = isAdjust ? "flex" : "none";

    if (!isAdjust) {
        includeVideoInput.checked = false;
    }

    if (isAccept) {
        messageInput.value = "";
        messageInput.placeholder = "Não é necessário texto para aceitar.";
    } else if (actionType.value === "ask") {
        messageInput.placeholder = "Digite sua pergunta...";
    } else {
        messageInput.placeholder = "Descreva o ajuste desejado...";
    }
}

function setLoading(isLoading) {
    loadingIndicator.classList.toggle("active", isLoading);
    btnStart.disabled = isLoading;
    btnSend.disabled = isLoading;
}

async function postJson(url, body) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.error || "Erro inesperado.");
    }

    return payload;
}

async function initSession() {
    const payload = await postJson("/api/session", {});
    state.sessionId = payload.sessionId;
    videoUrlInput.value = payload.videoUrl || "";
    logMessage("system", "Sessão criada. Informe/ajuste a URL e clique em 'Gerar seções'.");
}

btnStart.addEventListener("click", async () => {
    try {
        setLoading(true);
        logMessage("user", `Gerar seções para: ${videoUrlInput.value}`);

        const payload = await postJson("/api/start", {
            sessionId: state.sessionId,
            videoUrl: videoUrlInput.value,
        });

        state.parsed = payload.parsed;
        renderSections(state.parsed);
        logMessage("system", payload.message || "Seções geradas.");
    } catch (err) {
        logMessage("error", err.message || String(err));
    } finally {
        setLoading(false);
    }
});

btnSend.addEventListener("click", async () => {
    try {
        setLoading(true);

        const type = actionType.value;
        const message = messageInput.value.trim();

        if ((type === "ask" || type === "adjust") && !message) {
            throw new Error("Preencha a mensagem para continuar.");
        }

        logMessage("user", `Ação: ${type}${message ? `\n${message}` : ""}`);

        const payload = await postJson("/api/action", {
            sessionId: state.sessionId,
            actionType: type,
            message,
            includeVideo: includeVideoInput.checked,
        });

        if (payload.parsed) {
            state.parsed = payload.parsed;
            renderSections(state.parsed);
        }

        if (payload.answer) {
            logMessage("assistant", payload.answer);
        }

        if (Array.isArray(payload.files)) {
            logMessage("system", `${payload.message}\nArquivos: ${payload.files.join(", ")}`);
        } else {
            logMessage("system", payload.message || "Concluído.");
        }

        if (type !== "accept") {
            messageInput.value = "";
        }
    } catch (err) {
        logMessage("error", err.message || String(err));
    } finally {
        setLoading(false);
    }
});

actionType.addEventListener("change", updateActionUi);

updateActionUi();
renderSections(null);
initSession().catch((err) => logMessage("error", err.message || String(err)));
