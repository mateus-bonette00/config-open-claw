# Códios para ver e puxar arquivos do servidor (openclaw-server)

## Objetivo
Pegar arquivos `.html` que estão no servidor `openclaw-server` e baixar para o seu notebook nas pastas:

- Fornecedores: `~/Área de trabalho/Produtos-Fonecedores`
- Produtos que dão lucro: `~/Área de trabalho/Produtos-que-dao-Lucro`

## Importante (pra não dar erro)
1. **O comando de baixar (scp/rsync) você roda no NOTEBOOK**, em um terminal normal, **fora do SSH**.
2. Se você estiver dentro do servidor (aparecendo algo tipo `bonette@srv-desktop:~$`), saia com: `exit`
3. Teste se o acesso está ok:
   ```bash
   ssh openclaw-server "whoami && hostname"
   ```

## 1) Ver os arquivos `.html` no servidor (sem baixar)
1. Ver lista de HTMLs de fornecedores:
   ```bash
   ssh openclaw-server "ls -lh /home/bonette/Documentos/fornecedores-produtos/"
   ```
2. Ver lista de HTMLs de produtos que dão lucro:
   ```bash
   ssh openclaw-server "ls -lh /home/bonette/Documentos/produtos-amazon-lucros/"
   ```

Exemplo do que você vai ver: nomes de arquivos e tamanho, tipo `fba-aprovados-123.html`.

## 2) Baixar 1 arquivo específico (fornecedores -> notebook)
1. No NOTEBOOK, rode (troque `arquivo.html` pelo nome real):
   ```bash
   scp openclaw-server:/home/bonette/Documentos/fornecedores-produtos/arquivo.html "$HOME/Área de trabalho/Produtos-Fonecedores/"
   ```

Exemplo:
```bash
scp openclaw-server:/home/bonette/Documentos/fornecedores-produtos/fornecedor-abc.html "$HOME/Área de trabalho/Produtos-Fonecedores/"
```

## 3) Baixar TODOS os `.html` (fornecedores -> notebook)
1. No NOTEBOOK:
   ```bash
   scp openclaw-server:'/home/bonette/Documentos/fornecedores-produtos/*.html' "$HOME/Área de trabalho/Produtos-Fonecedores/"
   ```

## 4) Baixar 1 arquivo específico (produtos-amazon-lucros -> notebook)
1. No NOTEBOOK (troque `arquivo.html` pelo nome real):
   ```bash
   scp openclaw-server:/home/bonette/Documentos/produtos-amazon-lucros/arquivo.html "$HOME/Área de trabalho/Produtos-que-dao-Lucro/"
   ```

Exemplo:
```bash
scp openclaw-server:/home/bonette/Documentos/produtos-amazon-lucros/fba-aprovados-001.html "$HOME/Área de trabalho/Produtos-que-dao-Lucro/"
```

## 5) Baixar TODOS os `.html` (produtos-amazon-lucros -> notebook)
1. No NOTEBOOK:
   ```bash
   scp openclaw-server:'/home/bonette/Documentos/produtos-amazon-lucros/*.html' "$HOME/Área de trabalho/Produtos-que-dao-Lucro/"
   ```

## 6) (Recomendado) Baixar usando rsync (melhor pra repetir todo dia)
O `rsync` é melhor que `scp` porque ele copia mais rápido e você pode repetir sem ficar copiando tudo de novo.

1. Baixar só `.html` de fornecedores:
   ```bash
   rsync -av --progress --include='*.html' --exclude='*' \
     openclaw-server:/home/bonette/Documentos/fornecedores-produtos/ \
     "$HOME/Área de trabalho/Produtos-Fonecedores/"
   ```
2. Baixar só `.html` de produtos que dão lucro:
   ```bash
   rsync -av --progress --include='*.html' --exclude='*' \
     openclaw-server:/home/bonette/Documentos/produtos-amazon-lucros/ \
     "$HOME/Área de trabalho/Produtos-que-dao-Lucro/"
   ```

## 7) (Opcional) Baixar o HTML mais novo (o último gerado)
1. Fornecedores (mais novo):
   ```bash
   arquivo="$(ssh openclaw-server "ls -t /home/bonette/Documentos/fornecedores-produtos/*.html 2>/dev/null | head -n 1")"
   scp openclaw-server:"$arquivo" "$HOME/Área de trabalho/Produtos-Fonecedores/"
   ```
2. Produtos que dão lucro (mais novo):
   ```bash
   arquivo="$(ssh openclaw-server "ls -t /home/bonette/Documentos/produtos-amazon-lucros/*.html 2>/dev/null | head -n 1")"
   scp openclaw-server:"$arquivo" "$HOME/Área de trabalho/Produtos-que-dao-Lucro/"
   ```

Se der erro “No such file”, significa que ainda não existe nenhum `.html` nessa pasta no servidor.

## 8) Onde o FBA normalmente mexe (para você conferir no servidor)
Se você estiver usando o pipeline padrão do FBA do OpenClaw, os diretórios mais “certinhos” ficam dentro do projeto no servidor:

1. Entrada (HTMLs): `/home/bonette/openclaw-agents/amazon-fba/produtos-fornecedores-html`
2. Saída: `/home/bonette/openclaw-agents/amazon-fba/produtos-encontrados`

Para ver:
```bash
ssh openclaw-server "ls -lh /home/bonette/openclaw-agents/amazon-fba/produtos-encontrados/"
```

Se você estiver usando mesmo `/home/bonette/Documentos/produtos-amazon-lucros`, pode continuar usando os comandos das seções 4 e 5.
