# Guia Rápido - Sync das Artes da Pró-Saúde

## Objetivo
Baixar para o notebook todas as artes geradas no servidor.

## 1) Comando principal (manual)
Rode no terminal do NOTEBOOK:

```bash
/home/mateus/Documentos/Projetos/config-open-claw/scripts/sync-prosaude-artes.sh
```

## 2) Comando alternativo (estando dentro da pasta do projeto)

```bash
cd /home/mateus/Documentos/Projetos/config-open-claw
./scripts/sync-prosaude-artes.sh
```

## 3) Ver as artes baixadas

```bash
ls -lah /home/mateus/Documentos/artes-prosaude
```

## 4) Abrir a pasta das artes

```bash
xdg-open /home/mateus/Documentos/artes-prosaude
```

## 5) Comando de preparação (rodar 1 vez só)
Caso precise dar permissão de execução novamente:

```bash
chmod +x /home/mateus/Documentos/Projetos/config-open-claw/scripts/sync-prosaude-artes.sh
```

## 6) Importante: SSH
Você **não** precisa rodar esse script dentro do SSH.

- Rode no terminal local do seu notebook.
- O script já conecta no servidor por você e baixa as artes.
