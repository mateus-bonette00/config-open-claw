#!/usr/bin/env python3
"""
Moontech Outreach Runner

Fluxo:
1) Lê contatos do HubSpot.
2) Opcionalmente envia e-mail via Zoho SMTP.
3) Opcionalmente envia WhatsApp via Evolution API.

Por padrão roda em DRY-RUN.
Use --commit para envio real.
"""

import argparse
import json
import os
import re
import smtplib
import ssl
import sys
import urllib.error
import urllib.request
from email.mime.text import MIMEText
from email.utils import formataddr


HUBSPOT_CONTACT_PROPERTIES = [
    "firstname",
    "lastname",
    "email",
    "phone",
    "mobilephone",
    "company",
    "lifecyclestage",
    "hs_lead_status",
]


DEFAULT_EMAIL_SUBJECT = "Sugestão prática para reduzir retrabalho na sua operação"

DEFAULT_EMAIL_TEMPLATE = """Olá {first_name}, tudo bem?

Aqui é o Mateus, da Moontech.

Vi que a {company} tem perfil para ganho em padronização e rastreabilidade no processo de qualidade.

A Moontech implementa o {product_name}, uma solução que ajuda equipes a:
- padronizar o registro de não-conformidades,
- reduzir retrabalho e perdas operacionais,
- ganhar visibilidade para auditorias e compliance.

Se fizer sentido, te mostro em 15 minutos um cenário aplicado ao seu contexto.

Abraço,
{sender_name}
Moontech
{sender_email}
"""

DEFAULT_WHATSAPP_TEMPLATE = """Oi {first_name}, tudo bem?
Aqui é o Mateus da Moontech.

Te enviei um e-mail rápido sobre como o {product_name} ajuda a reduzir retrabalho com rastreio de não-conformidades.

Se fizer sentido, te mostro em 15 min e já te digo se vale para o seu cenário.
"""


def die(msg: str, code: int = 1) -> None:
    print(f"ERRO: {msg}", file=sys.stderr)
    sys.exit(code)


def env_required(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        die(f"Variável obrigatória ausente: {name}")
    return value


def http_json(
    method: str,
    url: str,
    headers: dict,
    payload: dict | None = None,
    timeout: int = 30,
) -> tuple[int, dict | list | str]:
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method.upper())
    for k, v in headers.items():
        req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            if not raw:
                return resp.status, {}
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw
    except Exception as e:
        return 0, {"error": str(e)}


def normalize_phone_br(raw_phone: str | None) -> str | None:
    if not raw_phone:
        return None
    digits = re.sub(r"\D", "", raw_phone)
    if not digits:
        return None
    if digits.startswith("00"):
        digits = digits[2:]
    if digits.startswith("0"):
        digits = digits.lstrip("0")
    if digits.startswith("55"):
        pass
    elif len(digits) in (10, 11):
        digits = "55" + digits
    return digits if len(digits) >= 12 else None


def load_template(path: str | None, fallback: str) -> str:
    if not path:
        return fallback
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip() or fallback


def fetch_hubspot_contacts(api_key: str, limit: int) -> list[dict]:
    url = "https://api.hubapi.com/crm/v3/objects/contacts/search"
    payload = {
        "limit": limit,
        "properties": HUBSPOT_CONTACT_PROPERTIES,
        "sorts": ["-lastmodifieddate"],
    }
    status, data = http_json(
        "POST",
        url,
        {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        payload,
    )
    if status != 200:
        die(f"Falha ao buscar contatos no HubSpot (HTTP {status}): {data}")
    return data.get("results", []) if isinstance(data, dict) else []


def get_whatsapp_instance_info(api_url: str, token: str, instance: str) -> dict | None:
    status, data = http_json(
        "GET",
        f"{api_url.rstrip('/')}/instance/fetchInstances",
        {"apikey": token, "Content-Type": "application/json"},
    )
    if status != 200 or not isinstance(data, list):
        return None
    for item in data:
        if item.get("name") == instance:
            return item
    return None


def assert_sender_number(api_url: str, token: str, instance: str, expected_sender: str) -> None:
    info = get_whatsapp_instance_info(api_url, token, instance)
    if not info:
        die(f"Instância WhatsApp '{instance}' não encontrada no Evolution.")

    connected = info.get("connectionStatus")
    # Algumas versoes da Evolution nao preenchem "number", mas informam em ownerJid.
    raw_number = str(info.get("number") or "")
    if not raw_number:
        raw_number = str(info.get("ownerJid") or "")
    number = re.sub(r"\D", "", raw_number)
    expected_digits = re.sub(r"\D", "", expected_sender)

    if connected != "open":
        die(
            f"Instância '{instance}' não está conectada (status: {connected}). "
            f"Conecte o WhatsApp Business {expected_sender} antes do envio."
        )

    if not number:
        die(f"Instância '{instance}' não informou número conectado.")

    if number != expected_digits:
        # Tolerancia para numeros BR onde um dos lados veio sem o digito 9 adicional.
        if expected_digits.startswith("55") and number.startswith("55"):
            local_expected = expected_digits[2:]
            local_number = number[2:]
            if len(local_expected) == 11 and len(local_number) == 10:
                if local_expected[:2] == local_number[:2] and local_expected[3:] == local_number[2:]:
                    return
        die(
            f"Número conectado na instância '{instance}' é {number}, "
            f"mas o esperado é {expected_digits}. Abortei para garantir remetente único."
        )


def send_zoho_email(
    smtp_host: str,
    smtp_port: int,
    smtp_user: str,
    smtp_password: str,
    from_name: str,
    to_email: str,
    subject: str,
    body: str,
) -> tuple[bool, str]:
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name, smtp_user))
    msg["To"] = to_email

    try:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(smtp_host, smtp_port, context=context, timeout=30) as server:
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, [to_email], msg.as_string())
        return True, "sent"
    except Exception as e:
        return False, str(e)


def send_whatsapp_text(
    api_url: str,
    token: str,
    instance: str,
    number: str,
    text: str,
) -> tuple[bool, str]:
    status, data = http_json(
        "POST",
        f"{api_url.rstrip('/')}/message/sendText/{instance}",
        {"apikey": token, "Content-Type": "application/json"},
        {"number": number, "text": text},
    )
    if status in (200, 201):
        return True, "sent"
    return False, f"HTTP {status} - {data}"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Outreach Moontech a partir de contatos do HubSpot (Zoho + WhatsApp)."
    )
    parser.add_argument("--limit", type=int, default=10, help="Quantidade de contatos para processar.")
    parser.add_argument("--product-name", default="Apolo", help="Nome do produto na copy.")
    parser.add_argument("--sender-name", default="Mateus", help="Nome do remetente.")
    parser.add_argument("--send-email", action="store_true", help="Habilita envio de e-mail.")
    parser.add_argument("--send-whatsapp", action="store_true", help="Habilita envio de WhatsApp.")
    parser.add_argument("--subject", default=DEFAULT_EMAIL_SUBJECT, help="Assunto do e-mail.")
    parser.add_argument("--email-template-file", help="Arquivo .txt com template de e-mail.")
    parser.add_argument("--whatsapp-template-file", help="Arquivo .txt com template de WhatsApp.")
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Sem esse parâmetro roda em DRY-RUN. Com --commit executa envios reais.",
    )
    parser.add_argument(
        "--confirm-send",
        default="",
        help='Confirmação obrigatória para envio real. Use exatamente: "ENVIAR AGORA".',
    )
    args = parser.parse_args()

    if not args.send_email and not args.send_whatsapp:
        die("Use ao menos --send-email ou --send-whatsapp.")

    if args.commit:
        expected_phrase = "ENVIAR AGORA"
        if args.confirm_send.strip() != expected_phrase:
            die(
                "Envio bloqueado por segurança. Para envio real, use: "
                '--commit --confirm-send "ENVIAR AGORA"'
            )

    hubspot_api_key = env_required("HUBSPOT_API_KEY")
    sender_email = env_required("ZOHO_SMTP_USER") if args.send_email else os.getenv("ZOHO_SMTP_USER", "").strip()
    smtp_host = os.getenv("ZOHO_SMTP_HOST", "smtp.zoho.com").strip()
    smtp_port = int(os.getenv("ZOHO_SMTP_PORT", "465").strip())
    smtp_password = env_required("ZOHO_SMTP_APP_PASSWORD") if args.send_email else os.getenv("ZOHO_SMTP_APP_PASSWORD", "").strip()

    whatsapp_api_url = env_required("WHATSAPP_API_URL") if args.send_whatsapp else os.getenv("WHATSAPP_API_URL", "").strip()
    whatsapp_api_token = env_required("WHATSAPP_API_TOKEN") if args.send_whatsapp else os.getenv("WHATSAPP_API_TOKEN", "").strip()
    whatsapp_instance = os.getenv("WHATSAPP_INSTANCE", "MoontechBot").strip()
    expected_sender = os.getenv("MOONTECH_WHATSAPP_SENDER", "5535997375147").strip()

    email_template = load_template(args.email_template_file, DEFAULT_EMAIL_TEMPLATE)
    whatsapp_template = load_template(args.whatsapp_template_file, DEFAULT_WHATSAPP_TEMPLATE)

    if args.send_whatsapp:
        assert_sender_number(whatsapp_api_url, whatsapp_api_token, whatsapp_instance, expected_sender)

    contacts = fetch_hubspot_contacts(hubspot_api_key, args.limit)
    if not contacts:
        print("Nenhum contato retornado pelo HubSpot.")
        return

    dry_run = not args.commit
    print(f"Modo: {'DRY-RUN' if dry_run else 'ENVIO REAL'}")
    print(f"Contatos recebidos: {len(contacts)}")

    report = []
    for c in contacts:
        props = c.get("properties", {})
        first_name = (props.get("firstname") or "").strip() or "time"
        last_name = (props.get("lastname") or "").strip()
        email = (props.get("email") or "").strip()
        company = (props.get("company") or "").strip() or "sua empresa"
        phone_raw = (props.get("mobilephone") or props.get("phone") or "").strip()
        phone_norm = normalize_phone_br(phone_raw)

        context = {
            "first_name": first_name,
            "last_name": last_name,
            "company": company,
            "email": email,
            "phone": phone_norm or phone_raw,
            "product_name": args.product_name,
            "sender_name": args.sender_name,
            "sender_email": sender_email,
        }

        item = {
            "id": c.get("id"),
            "name": f"{first_name} {last_name}".strip(),
            "company": company,
            "email": email,
            "phone_raw": phone_raw,
            "phone_normalized": phone_norm,
            "email_status": "skipped",
            "whatsapp_status": "skipped",
        }

        if args.send_email and email:
            email_body = email_template.format(**context)
            if dry_run:
                item["email_status"] = "dry-run"
            else:
                ok, msg = send_zoho_email(
                    smtp_host=smtp_host,
                    smtp_port=smtp_port,
                    smtp_user=sender_email,
                    smtp_password=smtp_password,
                    from_name=f"{args.sender_name} | Moontech",
                    to_email=email,
                    subject=args.subject.format(**context),
                    body=email_body,
                )
                item["email_status"] = "sent" if ok else f"error: {msg}"
        elif args.send_email:
            item["email_status"] = "missing-email"

        if args.send_whatsapp and phone_norm:
            wa_text = whatsapp_template.format(**context)
            if dry_run:
                item["whatsapp_status"] = "dry-run"
            else:
                ok, msg = send_whatsapp_text(
                    api_url=whatsapp_api_url,
                    token=whatsapp_api_token,
                    instance=whatsapp_instance,
                    number=phone_norm,
                    text=wa_text,
                )
                item["whatsapp_status"] = "sent" if ok else f"error: {msg}"
        elif args.send_whatsapp:
            item["whatsapp_status"] = "missing-phone"

        report.append(item)

    email_sent = sum(1 for r in report if r["email_status"] == "sent")
    wa_sent = sum(1 for r in report if r["whatsapp_status"] == "sent")

    print(json.dumps({"summary": {"email_sent": email_sent, "whatsapp_sent": wa_sent}, "report": report}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
