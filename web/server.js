"use strict";

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { createAtaService } = require("../src/core/ata-service");

const app = express();
const PORT = process.env.PORT || 3000;
const baseDir = path.join(__dirname, "..");

let service;
try {
    service = createAtaService(baseDir);
} catch (err) {
    console.error("Erro ao inicializar serviço:", err.message || err);
    process.exit(1);
}

const sessions = new Map();

function criarSessao() {
    const id = crypto.randomUUID();
    const session = {
        id,
        videoUrl: service.getDefaultVideoUrl(),
        parsed: null,
        lastReply: null,
    };
    sessions.set(id, session);
    return session;
}

function obterSessao(sessionId) {
    if (!sessionId || !sessions.has(sessionId)) return null;
    return sessions.get(sessionId);
}

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/session", (req, res) => {
    const session = criarSessao();
    res.json({
        sessionId: session.id,
        videoUrl: session.videoUrl,
        parsed: session.parsed,
    });
});

app.post("/api/start", async (req, res) => {
    const { sessionId, videoUrl } = req.body || {};
    const session = obterSessao(sessionId);

    if (!session) {
        res.status(400).json({ error: "Sessão inválida." });
        return;
    }

    try {
        session.videoUrl = (videoUrl || session.videoUrl || "").trim();
        if (!session.videoUrl) {
            res.status(400).json({ error: "Informe a URL do vídeo." });
            return;
        }

        session.parsed = await service.gerarSecoes(session.videoUrl);
        session.lastReply = null;

        res.json({
            parsed: session.parsed,
            videoUrl: session.videoUrl,
            message: "Seções iniciais geradas com sucesso.",
        });
    } catch (err) {
        res.status(500).json({ error: err.message || String(err) });
    }
});

app.post("/api/action", async (req, res) => {
    const { sessionId, actionType, message, includeVideo } = req.body || {};
    const session = obterSessao(sessionId);

    if (!session) {
        res.status(400).json({ error: "Sessão inválida." });
        return;
    }

    if (!session.parsed) {
        res.status(400).json({ error: "Gere as seções iniciais antes de continuar." });
        return;
    }

    try {
        if (actionType === "ask") {
            if (!message || !message.trim()) {
                res.status(400).json({ error: "Digite a pergunta." });
                return;
            }

            const answer = await service.perguntar(
                session.videoUrl,
                session.parsed,
                message.trim()
            );

            session.lastReply = answer;

            res.json({
                parsed: session.parsed,
                answer,
                message: "Pergunta respondida.",
            });
            return;
        }

        if (actionType === "adjust") {
            if (!message || !message.trim()) {
                res.status(400).json({ error: "Descreva o ajuste." });
                return;
            }

            const atualizado = await service.ajustar(
                session.videoUrl,
                session.parsed,
                message.trim(),
                Boolean(includeVideo)
            );

            session.parsed = atualizado;
            session.lastReply = null;

            res.json({
                parsed: session.parsed,
                message: "Seções atualizadas com sucesso.",
            });
            return;
        }

        if (actionType === "accept") {
            const files = service.aceitar(session.parsed);
            res.json({
                parsed: session.parsed,
                files,
                message: "Arquivos markdown gerados em result/.",
            });
            return;
        }

        res.status(400).json({ error: "Ação inválida." });
    } catch (err) {
        res.status(500).json({ error: err.message || String(err) });
    }
});

app.listen(PORT, () => {
    console.log(`Interface web disponível em http://localhost:${PORT}`);
});
