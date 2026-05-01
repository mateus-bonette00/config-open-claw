import re
from pathlib import Path

backend_dir = Path("/home/bonette/Documentos/apps/fba-automation/backend")
files_to_patch = [
    backend_dir / "automation" / "exporter.py",
    backend_dir / "api" / "automation.py",
    backend_dir / "export_supplier_products.py"
]

for f in files_to_patch:
    if not f.exists(): continue
    text = f.read_text()
    
    # Substituir ".. / exports / ARQUIVOS HTML" e afins
    text = re.sub(r'base_dir / "exports" / "ARQUIVOS HTML"', r'Path("/home/bonette/Documentos/fornecedores-produtos")', text)
    text = re.sub(r'Path\("../exports/ARQUIVOS HTML"\)', r'Path("/home/bonette/Documentos/fornecedores-produtos")', text)
    
    # Manter a referência do base_dir caso algo mais precise
    f.write_text(text)
    print(f"Updated {f}")

