import os
import asyncio
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import shutil
from datetime import datetime
from utils import get_supplier_price, check_amazon_profit # Importação das novas funções

# Configurações de Diretório baseadas no POP
BASE_DIR = os.path.expanduser("~/Documentos/Projetos/config-open-claw/agents/fba/exports/ARQUIVOS HTML")
INPUT_DIR = BASE_DIR
DONE_DIR = os.path.join(BASE_DIR, "Feitos")
PROFIT_DIR = os.path.join(BASE_DIR, "produtos que dão lucro")

# Regras de Negócio
PREP_COST = 2.00
MIN_MARGIN = 10.0

async def process_html_file(file_path):
    print(f"[*] Processando arquivo: {file_path}")
    with open(file_path, 'r', encoding='utf-8') as f:
        soup = BeautifulSoup(f.read(), 'html.parser')
    
    # Supondo que a tabela tenha uma estrutura padrão identificável
    rows = soup.find_all('tr')[1:] # Pula o cabeçalho
    approved_products = []

    async with async_playwright() as p:
        # Usa o perfil padrão do usuário para carregar extensões (AZInsight/Keepa)
        # IMPORTANTE: O usuário deve estar logado no navegador Chrome antes de rodar
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=os.path.expanduser("~/.config/google-chrome/Default"),
            headless=False # Mantém visível para carregar plugins corretamente
        )
        page = await browser.new_page()

        for row in rows:
            cols = row.find_all('td')
            if len(cols) < 5: continue

            product_data = {
                "id": cols[0].text.strip(),
                "name": cols[1].text.strip(),
                "supplier_url": cols[2].find('a')['href'] if cols[2].find('a') else "",
                "upc_search_url": cols[3].find('a')['href'] if cols[3].find('a') else "",
                "title_search_url": cols[4].find('a')['href'] if cols[4].find('a') else ""
            }

            print(f"[+] Analisando: {product_data['name']}")
            
            # 1. Pegar preço no fornecedor
            supplier_price = await get_supplier_price(page, product_data['supplier_url'])
            
            if supplier_price:
                # 2. Validar lucro na Amazon (AZInsight)
                is_profitable = await check_amazon_profit(
                    page, 
                    product_data['upc_search_url'], 
                    product_data['title_search_url'], 
                    supplier_price
                )
                
                if is_profitable:
                    approved_products.append(product_data)
                    print(f"[V] Produto aprovado adicionado à lista!")
            
            # TODO: Gerar o relatório HTML final com approved_products
            
        await browser.close()
    
    # FASE 6: Gestão de Arquivos
    shutil.move(file_path, os.path.join(DONE_DIR, os.path.basename(file_path)))

async def main():
    # Loop para monitorar a pasta
    while True:
        files = [f for f in os.listdir(INPUT_DIR) if f.endswith('.html') and os.path.isfile(os.path.join(INPUT_DIR, f))]
        if not files:
            print("[.] Aguardando novos arquivos...")
            await asyncio.sleep(10)
            continue
        
        for file in files:
            await process_html_file(os.path.join(INPUT_DIR, file))

if __name__ == "__main__":
    asyncio.run(main())
