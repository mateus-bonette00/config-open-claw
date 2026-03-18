Eu quero essas skills abaixo só:

# skills-para-antigravity.md

**Guia Oficial de Skills para o Ambiente de Desenvolvimento**

## 🛠️ Como usar as Skills no Antigravity

Para ativar uma skill, você deve mencioná-la usando o prefixo `@` no início do seu prompt. Isso direciona a IA para assumir aquele papel específico e usar os conhecimentos daquela ferramenta.

**A Fórmula de Ouro para Prompts:**
`@nome-da-skill` + `[Contexto do Projeto]` + `[O Problema/Tarefa]` + `[Formato Desejado]`

**Exemplo Prático de Uso:**

> "@postgres-best-practices Estou estruturando o banco de dados da plataforma. Analise a query SQL abaixo e me diga se há riscos de performance. Gere um resumo em tópicos curtos."

---

## 📚 Catálogo de Skills Essenciais

### 1. Engenharia e Criação de Prompts

- **Skill:** `@prompt-engineering-patterns`
- **O que faz:** Especialista em padrões de arquitetura de prompts. Ajuda a criar comandos precisos, reutilizáveis e com baixo risco de alucinação da IA.
- **Quando usar:** Quando você precisar criar um prompt mestre para uma automação ou para um agente de IA seguir uma regra estrita de negócio.

### 2. Automação e CI/CD

- **Skill:** `@github-workflow-automation`
- **O que faz:** Foca na criação de pipelines, integração e entrega contínua (CI/CD) usando GitHub Actions.
- **Quando usar:** Na hora de automatizar testes, build e deploy da sua aplicação, garantindo que o código vá para produção de forma segura.

### 3. Servidor Físico, Linux e Infraestrutura

- **Skill:** `@bash-linux`
- **O que faz:** Seu administrador de sistemas particular. Focado em comandos de terminal, manipulação de arquivos, permissões, rede e gestão de processos no Ubuntu.
- **Quando usar:** Para resolver problemas no seu servidor desktop, ler logs de sistema, configurar firewall ou acessar a máquina via SSH.

### 4. Contêineres e Orquestração (Docker)

- **Skill:** `@docker-pro` (ou `@docker-compose-expert`)
- **O que faz:** Especialista na criação, segurança e gerenciamento de contêineres e redes virtuais. Foca em criar imagens leves (Dockerfile) e orquestrar múltiplos serviços (Docker Compose).
- **Quando usar:** Para configurar e subir o ambiente do banco de dados, backend e frontend no seu servidor Ubuntu 24. Ideal para mapear portas, criar volumes (para não perder dados se o servidor reiniciar) e debugar contêineres que não querem iniciar.

### 5. Arquitetura Backend e Full-stack

- **Skills:** `@senior-fullstack` e `@api-design-principles`
- **O que fazem:** A primeira atua como um engenheiro experiente que entende como conectar o front e o back. A segunda foca exclusivamente em como desenhar rotas, autenticação e comunicação de APIs de forma escalável.
- **Quando usar:** Quando for estruturar as rotas do Node/Express ou do Python (FastAPI), garantindo que a comunicação da aplicação seja segura e siga os padrões REST.

### 6. Banco de Dados (Relacional)

- **Skill:** `@postgres-best-practices`
- **O que faz:** Especialista em PostgreSQL. Foca em modelagem de dados, otimização de consultas (queries), índices e segurança da informação.
- **Quando usar:** Sempre que for criar uma nova tabela, fazer migrações de dados ou resolver problemas de lentidão no banco.

### 7. Front-end e Experiência do Usuário (UX/UI)

- **Skills:** `@react-best-practices` e `@ui-ux-pro-max`
- **O que fazem:** A skill de React foca em código limpo, gerenciamento de estado e componentes reutilizáveis. A de UX/UI foca em usabilidade, conversão e design moderno.
- **Quando usar:** Ao criar telas novas, refatorar componentes lentos no React ou pedir dicas de como melhorar o layout para o usuário final.

### 8. Automações em Python (Backend Dinâmico)

- **Skill:** `@async-python-patterns`
- **O que faz:** Especialista em concorrência e programação assíncrona (`asyncio`) no Python.
- **Quando usar:** Quando for criar scripts que precisem consumir APIs externas de forma rápida, rodar tarefas em segundo plano ou lidar com grande volume de dados sem travar a aplicação.

### 9. Arquitetura de Agentes de IA

- **Skill:** `@ai-agents-architect`
- **O que faz:** Desenha a planta baixa de sistemas que usam múltiplos agentes de IA conversando entre si.
- **Quando usar:** Antes de escrever o código de uma IA, use essa skill para definir qual agente faz o que, como eles se comunicam e como evitar loops infinitos.

### 10. Criação de Skills Open Claw

- **Skill:** `@openclaw-architect`
- **O que faz:** Especialista em criar novas habilidades compatíveis com o Open Claw (Clawdbot). Sabe criar a estrutura de pastas, o arquivo `SKILL.md` (metadados) e os scripts Python/Node.js necessários.
- **Quando usar:** Quando você quiser que o seu agente ganhe uma nova função, como "Ler Notion", "Acessar Gmail" ou "Controlar Linear", seguindo o padrão oficial de diretórios.
