---
name: skill-creator
description: Cria e organiza novas expertises (skills) para o Antigravity. Use sempre que o usuário quiser adicionar uma nova capacidade, automatizar um fluxo repetitivo ou estruturar o conhecimento do agente sobre um novo domínio.
---

# Skill Creator - O Criador de Habilidades

Este guia orienta o Antigravity na criação de novas skills de alta qualidade, garantindo que o agente aprenda e automatize processos de forma padronizada.

## 🚀 Como Criar uma Nova Skill

Uma skill de sucesso segue estas etapas:

### 1. Entender o Objetivo
Descubra o que a skill deve fazer:
- Qual problema ela resolve?
- Quando ela deve ser ativada? (Triggering)
- Qual o formato de saída esperado?

### 2. Estrutura de Pastas
As skills no projeto `config-open-claw` seguem este padrão:
`.agents/skills/[nome-da-skill]/SKILL.md`

Pastas opcionais:
- `/scripts/`: Scripts que executam tarefas repetitivas.
- `/references/`: Documentação extra para consulta.
- `/assets/`: Modelos de arquivos, ícones ou templates.

### 3. Escrever o SKILL.md
O arquivo deve conter:
- **YAML Frontmatter**: `name` e `description`. A descrição é CRUCIAL, pois é ela que faz o Antigravity decidir usar a skill. Seja sugestivo ("Use esta skill sempre que...").
- **Instruções Claras**: Use verbos no imperativo. Explique o "porquê" além do "o quê".

### 4. Ciclo de Melhoria (Loop Iterativo)
- **Rascunho**: Crie a primeira versão.
- **Teste**: Simule usos reais.
- **Feedback**: Ajuste com base no que deu errado.
- **Finalização**: Documente exemplos de sucesso.

## 🛠️ Regras de Ouro
- **Simplicidade**: Use termos fáceis e diretos.
- **Objetividade**: Não "encha linguiça". Vá direto ao ponto.
- **Padrão**: Respeite a estrutura do projeto `config-open-claw`.
