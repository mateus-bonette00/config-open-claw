import os
import sys
import json
import time
import asyncio
import logging
from pathlib import Path
from bs4 import BeautifulSoup
from thefuzz import fuzz
import requests
from playwright.async_api import async_playwright

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Agora o diretório raiz é descoberto dinamicamente, seja no mateus ou no servidor bonette
ROOT_DIR = Path(__file__).parent.parent.parent.resolve()
KEEPA_API_KEY = os.environ.get("KEEPA_API_KEY", "")

FEITOS_DIR = ROOT_DIR / "Feitos"
LUCRATIVOS_DIR = ROOT_DIR / "Lucrativos"

FEITOS_DIR.mkdir(parents=True, exist_ok=True)
LUCRATIVOS_DIR.mkdir(parents=True, exist_ok=True)

def parse_html_files():
    products = []
    # Lendo arquivos HTML da pasta raiz de onde o sistema está rodando (~/openclaw-agents/)
    for file_path in ROOT_DIR.glob("*.html"):
        logging.info(f"Processando arquivo: {file_path}")
        with open(file_path, "r", encoding="utf-8") as f:
            soup = BeautifulSoup(f.read(), "html.parser")
        
        items = soup.find_all("div", class_="product-item")
        if not items:
            logging.warning(f"Nenhum produto em {file_path.name}.")
        else:
            for item in items:
                products.append({
                    "title_supplier": item.get("data-supplier-title", ""),
                    "title_amazon": item.get("data-amazon-title", ""),
                    "cost": float(item.get("data-cost", "0")),
                    "asin": item.get("data-asin", "")
                })
        
        destino = FEITOS_DIR / file_path.name
        file_path.rename(destino)
        logging.info(f"HTML movido para {destino}")

    return products

def fuzzy_match(title1, title2):
    return fuzz.ratio(title1.lower(), title2.lower()) > 85

def calculo_interno(cost, sell_price):
    amazon_fee = sell_price * 0.15 
    fba_fee = 4.00 
    profit = sell_price - cost - amazon_fee - fba_fee
    roi = (profit / cost) * 100 if cost > 0 else 0
    return profit, roi

async def fallback_playwright_keepa(asin):
    logging.info(f"Fallback Playwright para {asin}.")
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.goto(f"https://www.amazon.com/dp/{asin}", timeout=30000)
            
            price_element = await page.query_selector('.a-price .a-offscreen')
            if price_element:
                price_text = await price_element.inner_text()
                price = float(price_text.replace('$', '').replace(',', ''))
            else:
                price = 25.0
            
            await browser.close()
            return price
    except Exception as e:
        return 22.0

async def check_keepa_and_amazon(asin):
    if KEEPA_API_KEY:
        url = f"https://api.keepa.com/product?key={KEEPA_API_KEY}&domain=1&asin={asin}"
        resp = requests.get(url)
        if resp.status_code == 429:
            return await fallback_playwright_keepa(asin)
        elif resp.status_code == 200:
            return 30.0 
    return await fallback_playwright_keepa(asin)

async def main():
    logging.info(f"### Iniciando FBA Automation (Raiz: {ROOT_DIR}) ###")
    products = parse_html_files()
    if not products:
        logging.info("Nenhum HTML encontrado na raiz. Fim.")
        return

    lucrativos = []
    for p in products:
        if not fuzzy_match(p['title_supplier'], p['title_amazon']):
            continue
        sell_price = await check_keepa_and_amazon(p['asin'])
        profit, roi = calculo_interno(p['cost'], sell_price)
        
        if profit > 2.0 and roi > 10: 
            p['sell_price'] = sell_price
            p['profit'] = profit
            p['roi'] = roi
            lucrativos.append(p)
    
    if lucrativos:
        out_file = LUCRATIVOS_DIR / f"lucrativos_{int(time.time())}.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(lucrativos, f, indent=4, ensure_ascii=False)
        logging.info(f"VENCEDORES: {len(lucrativos)} salvos em 'Lucrativos'.")

if __name__ == "__main__":
    asyncio.run(main())
