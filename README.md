<div align="center">

# 🚀 Memizy (Zlehčito)

**Memorizing, made easy.**

![Status](https://img.shields.io/badge/Status-Live-success?style=for-the-badge)
![Ecosystem](https://img.shields.io/badge/Ecosystem-Open-blue?style=for-the-badge)

<br>

**Memizy** (known as **Zlehčito** in Czechia) is a modern, local-first educational platform for students, medics, and lifelong learners. It combines the power of Spaced Repetition, systematic note learning, and gamification, all running blazingly fast directly in your browser.

🌐 **[Try Memizy Now](https://memizy.com)**

</div>

---

## 🗺️ The Memizy Ecosystem

While the core Memizy engine is proprietary to ensure the best, secure, and unified user experience, **our data formats, plugins, and official study library are 100% Open-Source.** This repository serves as the **Central Hub, Issue Tracker, and Discussion Board** for the entire Memizy ecosystem.

### 📚 Data & Content
* **[`oqse-specification`](https://github.com/memizy/oqse-specification)**: The official documentation and TypeScript types for the Open Question Set Exchange (OQSE) format. Learn how to create your own study sets here.
* **[`open-library`](https://github.com/memizy/open-library)**: The central registry of all public, community-driven study sets.

### 🧩 Developers & Plugins
* **[`plugin-sdk`](https://github.com/memizy/plugin-sdk)**: Want to build a 3D anatomy minigame or a math visualizer? Start here. Contains the SDK, documentation, and a Vite starter template for Memizy plugins.
* **[`plugin-registry`](https://github.com/memizy/plugin-registry)**: The official index of approved community plugins available within the Memizy app.

---

## 🏗️ Repository Layout

This repository is a [Bun workspaces](https://bun.sh/docs/install/workspaces) monorepo. Each package is published to npm independently.

| Path | Contents |
| :--- | :--- |
| `packages/oqse` | `@memizy/oqse` – OQSE specification, TypeScript types and Zod validators |
| `packages/protocol` | `@memizy/protocol` – Memizy Plugin Protocol (spec, types, schemas) |
| `packages/plugin-sdk` | `@memizy/plugin-sdk` – the SDK for building Memizy plugins |
| `services/` | Backend services (multiplayer server) |
| `apps/` | Developer apps (Plugin Lab) |
| `plugins/` | Official plugins |
| `games/` | Official standalone games |
| `docs/` | Architecture notes and public documentation |

```bash
bun install      # install all workspaces
bun run build    # build all packages
bun run test     # run all tests
```

---

## 🌟 Core Features of the App

| Feature | Description |
| :--- | :--- |
| **🌍 Local-First** | Powered by OPFS and IndexedDB. Works completely offline. |
| **📖 Contextual Learning** | Don't just flip cards. Read your notes and use our "Traffic Light" system for frictionless spaced repetition. |
| **🤖 AI Powered** | Generate flashcards and notes from your study materials using integrated AI APIs. |
| **🔌 Plugin Engine** | Expand the app's capabilities with community-built HTML/JS plugins (sandboxed). |
| **🔒 Ultimate Privacy** | No login required to start. Your data never leaves your device unless you opt into Cloud Sync. |

---

## 💬 Support & Feedback

Found a bug or have a feature request? You are in the right place!

1. Check our [GitHub Discussions](https://github.com/memizy/memizy/discussions) to see if it's already being talked about.
2. If you found a bug in the app, please **[Open an Issue](https://github.com/memizy/memizy/issues/new/choose)** using our provided templates.

---

<div align="center">
  <i>The documentation and open-source tools in this ecosystem are licensed under the MIT License.</i>
</div>
