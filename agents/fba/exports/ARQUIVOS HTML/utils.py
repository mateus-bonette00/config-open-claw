import re

async def get_supplier_price(page, url):
    """Extrai o preço do site do fornecedor"""
    try:
        print(f"[*] Acessando fornecedor: {url}")
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        # Lógica genérica de extração de preço (pode precisar de ajustes por site)
        content = await page.content()
        # Procura por padrões de cifrão e números (ex: $9.99 ou $ 9,99)
        price_match = re.search(r'\$\s?(\d+[\.,]\d{2})', content)
        if price_match:
            price = float(price_match.group(1).replace(',', '.'))
            print(f"[V] Preço fornecedor encontrado: ${price}")
            return price
    except Exception as e:
        print(f"[X] Erro ao buscar preço no fornecedor: {e}")
    return None

async def check_amazon_profit(page, upc_url, title_url, supplier_price):
    """Lógica central de decisão de lucro na Amazon"""
    target_url = upc_url if upc_url else title_url
    if not target_url: return False
    
    try:
        print(f"[*] Acessando Amazon: {target_url}")
        await page.goto(target_url, wait_until="networkidle", timeout=60000)
        
        # 1. Esperar AZInsight carregar (o input de custo de compra)
        await page.wait_for_selector('input[placeholder*="Buy Cost"]', timeout=20000)
        
        # 2. Calcular custo total (Fornecedor + Prep Center)
        total_cost = supplier_price + 2.00
        
        # 3. Inserir no campo do AZInsight
        await page.fill('input[placeholder*="Buy Cost"]', str(total_cost))
        await page.keyboard.press("Enter")
        await asyncio.sleep(2) # Aguarda o plugin recalcular
        
        # 4. Ler a Margem
        margin_element = await page.query_selector('.az-margin-value') # Seletor hipotético do AZInsight
        if margin_element:
            margin_text = await margin_element.inner_text()
            margin_val = float(re.sub(r'[^\d\.-]', '', margin_text))
            
            if margin_val >= 10.0:
                print(f"[$$$] PRODUTO APROVADO! Margem: {margin_val}%")
                return True
            else:
                print(f"[-] Margem insuficiente: {margin_val}%")
        
    except Exception as e:
        print(f"[X] Erro na análise Amazon: {e}")
    
    return False
