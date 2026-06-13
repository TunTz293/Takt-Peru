#!/usr/bin/env python3
"""
Monitor Prestamype investment opportunities and send email alerts
when annualized return > 18%.

Required environment variables:
  PRESTAMYPE_TOKEN   - Bearer token from Prestamype session (see README)
  GMAIL_USER         - Gmail address to send alerts from
  GMAIL_APP_PASSWORD - Gmail App Password (not your regular password)
  ALERT_EMAIL        - Email address to receive alerts
"""

import os
import json
import smtplib
import sys
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests

PRESTAMYPE_API = "https://www.prestamype.com/api/v1/inversionista/oportunidades"
MIN_RETURN = 18.0
ALERT_EMAIL = os.environ.get("ALERT_EMAIL", "warcaya.armar@gmail.com")
GMAIL_USER = os.environ.get("GMAIL_USER", "")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")
PRESTAMYPE_TOKEN = os.environ.get("PRESTAMYPE_TOKEN", "")

SEEN_IDS_FILE = "/tmp/prestamype_seen_ids.json"


def load_seen_ids() -> set:
    try:
        with open(SEEN_IDS_FILE) as f:
            return set(json.load(f))
    except (FileNotFoundError, json.JSONDecodeError):
        return set()


def save_seen_ids(ids: set):
    with open(SEEN_IDS_FILE, "w") as f:
        json.dump(list(ids), f)


def fetch_opportunities() -> list:
    headers = {
        "Authorization": f"Bearer {PRESTAMYPE_TOKEN}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
    }
    resp = requests.get(PRESTAMYPE_API, headers=headers, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    # Handle both list and {"data": [...]} response shapes
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("data", data.get("oportunidades", []))
    return []


def extract_return(opp: dict) -> float:
    """Try common field names for annualized return."""
    for key in ("tasa_anual", "tasa_retorno", "retorno_anualizado",
                "tasa", "annual_rate", "rate", "rendimiento_anual"):
        val = opp.get(key)
        if val is not None:
            try:
                return float(str(val).replace("%", "").strip())
            except ValueError:
                pass
    return 0.0


def build_email_html(opportunities: list) -> str:
    rows = ""
    for opp in opportunities:
        opp_id = opp.get("id", "-")
        nombre = opp.get("nombre", opp.get("name", opp.get("empresa", "-")))
        retorno = extract_return(opp)
        monto = opp.get("monto", opp.get("amount", "-"))
        plazo = opp.get("plazo", opp.get("term", "-"))
        riesgo = opp.get("riesgo", opp.get("risk", "-"))
        rows += f"""
        <tr>
          <td style="padding:8px;border:1px solid #ddd">{opp_id}</td>
          <td style="padding:8px;border:1px solid #ddd">{nombre}</td>
          <td style="padding:8px;border:1px solid #ddd;color:#16a34a;font-weight:bold">{retorno:.2f}%</td>
          <td style="padding:8px;border:1px solid #ddd">S/ {monto}</td>
          <td style="padding:8px;border:1px solid #ddd">{plazo} días</td>
          <td style="padding:8px;border:1px solid #ddd">{riesgo}</td>
        </tr>"""

    return f"""
    <html><body style="font-family:Arial,sans-serif;margin:0;padding:20px">
      <h2 style="color:#1e40af">🔔 Prestamype — Oportunidades &gt; {MIN_RETURN}% anual</h2>
      <p>Se encontraron <strong>{len(opportunities)}</strong> oportunidad(es) con retorno anualizado
         mayor a <strong>{MIN_RETURN}%</strong>.</p>
      <table style="border-collapse:collapse;width:100%;margin-top:16px">
        <thead>
          <tr style="background:#1e40af;color:white">
            <th style="padding:10px;text-align:left">ID</th>
            <th style="padding:10px;text-align:left">Empresa</th>
            <th style="padding:10px;text-align:left">Retorno anual</th>
            <th style="padding:10px;text-align:left">Monto</th>
            <th style="padding:10px;text-align:left">Plazo</th>
            <th style="padding:10px;text-align:left">Riesgo</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <p style="margin-top:24px">
        <a href="https://www.prestamype.com/app/inversionista/oportunidades"
           style="background:#1e40af;color:white;padding:10px 20px;text-decoration:none;border-radius:6px">
          Ver en Prestamype
        </a>
      </p>
      <p style="color:#6b7280;font-size:12px;margin-top:20px">
        Alerta generada el {datetime.now().strftime("%d/%m/%Y %H:%M")} UTC
      </p>
    </body></html>
    """


def send_email(opportunities: list):
    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"[Prestamype] {len(opportunities)} oportunidad(es) con retorno > {MIN_RETURN}%"
    msg["From"] = GMAIL_USER
    msg["To"] = ALERT_EMAIL

    plain = f"Hay {len(opportunities)} oportunidad(es) con retorno > {MIN_RETURN}% en Prestamype.\n"
    plain += "Ver: https://www.prestamype.com/app/inversionista/oportunidades\n\n"
    for opp in opportunities:
        nombre = opp.get("nombre", opp.get("name", opp.get("empresa", "-")))
        retorno = extract_return(opp)
        plain += f"- {nombre}: {retorno:.2f}% anual\n"

    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(build_email_html(opportunities), "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        server.sendmail(GMAIL_USER, ALERT_EMAIL, msg.as_string())

    print(f"✅ Email enviado a {ALERT_EMAIL} con {len(opportunities)} oportunidad(es).")


def main():
    if not PRESTAMYPE_TOKEN:
        print("❌ PRESTAMYPE_TOKEN no configurado.", file=sys.stderr)
        sys.exit(1)
    if not GMAIL_USER or not GMAIL_APP_PASSWORD:
        print("❌ GMAIL_USER / GMAIL_APP_PASSWORD no configurados.", file=sys.stderr)
        sys.exit(1)

    print(f"🔍 Consultando Prestamype... ({datetime.now().strftime('%H:%M UTC')})")
    opportunities = fetch_opportunities()
    print(f"   {len(opportunities)} oportunidad(es) totales encontradas.")

    seen = load_seen_ids()
    filtered = []
    for opp in opportunities:
        opp_id = str(opp.get("id", ""))
        if extract_return(opp) > MIN_RETURN and opp_id not in seen:
            filtered.append(opp)

    print(f"   {len(filtered)} nueva(s) con retorno > {MIN_RETURN}%.")

    if filtered:
        send_email(filtered)
        seen.update(str(opp.get("id", "")) for opp in filtered)
        save_seen_ids(seen)
    else:
        print("   Sin nuevas oportunidades para alertar.")


if __name__ == "__main__":
    main()
