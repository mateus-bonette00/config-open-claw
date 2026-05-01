import os
import sys

def create_skill(name, description):
    base_dir = "/home/mateus/Documentos/Projetos/config-open-claw/.agents/skills"
    skill_dir = os.path.join(base_dir, name)
    skill_file = os.path.join(skill_dir, "SKILL.md")

    if os.path.exists(skill_dir):
        print(f"Erro: A skill '{name}' já existe em {skill_dir}")
        return

    os.makedirs(skill_dir, exist_ok=True)
    os.makedirs(os.path.join(skill_dir, "scripts"), exist_ok=True)

    content = f"""---
name: {name}
description: {description}. Use esta skill sempre que o usuário mencionar {name.replace('-', ' ')} ou precisar de ajuda com esse domínio.
---

# {name.replace('-', ' ').title()}

Descreva aqui as instruções principais da sua nova skill.

## 📋 Como usar
1. Passo 1
2. Passo 2

## 🛠️ Regras
- Regra 1
"""
    with open(skill_file, "w") as f:
        f.write(content)
    
    print(f"Sucesso! Skill '{name}' criada em {skill_dir}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python3 scaffold_skill.py <nome-da-skill> <descrição>")
    else:
        create_skill(sys.argv[1], sys.argv[2])
