#!/usr/bin/env python3
"""
Monitor Prestamype investment opportunities using browser automation.
Logs in with email/password, scrapes opportunities, and sends email alerts
when annualized return > 18%.

Required environment variables:
  PRESTAMYPE_EMAIL    - Your Prestamype login email
  PRESTAMYPE_PASSWORD - Your Prestamype login password
  GMAIL_USER          - Gmail address to send alerts from
  GMAIL_APP_PASSWORD  - Gmail App Password
  ALERT_EMAIL         - Email address to receive alerts (default: warcaya.armar@gmail.com)
"""

import json
import os
import re
import smtplib
import sys
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError

MIN_RETURN = 18.0
ALERT_EMAIL = os.environ.get("ALERT_EMAIL", "warcaya.armar@gmail.com")
GMAIL_USER = os.environ.get("GMAIL_USER", "")
GMAIL_APP_PASSWORD = os.environ.get("GMAIL_APP_PASSWORD", "")
PRESTAMYPE_EMAIL = os.environ.get("PRESTAMYPE_EMAIL", "")
PRESTAMYPE_PASSWORD = os.environ.get("PRESTAMYPE_PASSWORD", "")

SEEN_IDS_FILE = "/tmp/prestamype_seen_ids.json"
OPPORTUNITIES_URL = "https://www.prestamype.com/app/inversionista/oportunidades"
LOGIN_URL = "https://www.prestamype.com/app/login"


def load_seen_ids() -> set:
    try:
        with open(SEEN_IDS_FILE) as f:
            return set(json.load(f))
    except (FileNotFoundError, json.JSONDecodeError):
        return set()


def save_seen_ids(ids: set):
    with open(SEEN_IDS_FILE, "w") as f:
        json.dump(list(ids), f)


def parse_percentage(text: str) -> float:
    """Extract a float percentage from a string like '19.5%' or '19,5 %'."""
    text = text.replace(",", ".").strip()
    match = re.search(r"(\d+(?:\.\d+)?)", text)
    return float(match.group(1)) if match else 0.0


def parse_amount(text: str) -> str:
    return text.strip().replace("\xa0", " ")


def scrape_opportunities(page) -> list:
    """
    Scrape the opportunities table/cards from the page.
    Tries multiple selectors to handle different page layouts.
    """
    page.wait_for_load_state("networkidle", timeout=20000)

    opportunities = []

    # --- Strategy 1: intercept API response via network ---
    # (already tried via requests; here as fallback if page makes XHR)

    # --- Strategy 2: parse visible cards/rows ---
    # Try card-based layout
    cards = page.query_selector_all("[class*='oportunidad'], [class*='opportunity'], [class*='card']")

    for i, card in enumerate(cards):
        text = card.inner_text()
        lines = [l.strip() for l in text.splitlines() if l.strip()]

        # Look for percentage values in the card
        pct_matches = re.findall(r"(\d+(?:[.,]\d+)?)\s*%", text)
        if not pct_matches:
            continue

        annual_rate = max(parse_percentage(p) for p in pct_matches)
        if annual_rate == 0:
            continue

        # Extract amount (look for S/ or PEN patterns)
        amount_match = re.search(r"S[/\s]+[\d,\.]+", text)
        amount = amount_match.group(0) if amount_match else "-"

        # Extract term in days
        days_match = re.search(r"(\d+)\s*d[ií]as?", text, re.IGNORECASE)
        days = days_match.group(1) if days_match else "-"

        name = lines[0] if lines else f"Oportunidad {i+1}"

        opportunities.append({
            "id": f"card_{i}",
            "nombre": name,
            "tasa_anual": annual_rate,
            "monto": amount,
            "plazo": days,
            "riesgo": "-",
        })

    if opportunities:
        return opportunities

    # --- Strategy 3: table rows ---
    rows = page.query_selector_all("table tr")
    for i, row in enumerate(rows[1:], 1):  # skip header
        cells = [td.inner_text().strip() for td in row.query_selector_all("td")]
        if not cells:
            continue

        pct_vals = []
        for cell in cells:
            pct_matches = re.findall(r"(\d+(?:[.,]\d+)?)\s*%", cell)
            pct_vals.extend(parse_percentage(p) for p in pct_matches)

        if not pct_vals:
            continue

        annual_rate = max(pct_vals)
        opportunities.append({
            "id": f"row_{i}",
            "nombre": cells[0] if cells else f"Fila {i}",
            "tasa_anual": annual_rate,
            "monto": cells[1] if len(cells) > 1 else "-",
            "plazo": cells[2] if len(cells) > 2 else "-",
            "riesgo": cells[3] if len(cells) > 3 else "-",
        })

    return opportunities


def fetch_opportunities_with_browser() -> list:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        page = context.new_page()

        # --- Login ---
        print("   Abriendo página de login...")
        page.goto(LOGIN_URL, wait_until="networkidle", timeout=30000)

        # Fill email
        email_sel = "input[type='email'], input[name='email'], input[placeholder*='correo'], input[placeholder*='email']"
        page.wait_for_selector(email_sel, timeout=10000)
        page.fill(email_sel, PRESTAMYPE_EMAIL)

        # Fill password
        pwd_sel = "input[type='password']"
        page.fill(pwd_sel, PRESTAMYPE_PASSWORD)

        # Submit
        submit_sel = "button[type='submit'], input[type='submit'], button:has-text('Ingresar'), button:has-text('Iniciar')"
        page.click(submit_sel)

        # Wait for navigation after login
        try:
            page.wait_for_url("**/app/**", timeout=15000)
        except PWTimeoutError:
            # Check for error message
            error = page.query_selector("[class*='error'], [class*='alert']")
            if error:
                print(f"❌ Error de login: {error.inner_text()}", file=sys.stderr)
            else:
                print("⚠️  Login tardó más de lo esperado, continuando...", file=sys.stderr)

        # --- Navigate to opportunities ---
        print("   Navegando a oportunidades...")
        page.goto(OPPORTUNITIES_URL, wait_until="networkidle", timeout=30000)

        # Check if redirected back to login (session failed)
        if "/login" in page.url:
            browser.close()
            print("❌ Sesión inválida — verifica PRESTAMYPE_EMAIL y PRESTAMYPE_PASSWORD.", file=sys.stderr)
            sys.exit(1)

        print("   Extrayendo oportunidades...")
        opportunities = scrape_opportunities(page)
        browser.close()
        return opportunities


def build_email_html(opportunities: list) -> str:
    rows = ""
    for opp in opportunities:
        retorno = float(opp.get("tasa_anual", 0))
        rows += f"""
        <tr>
          <td style="padding:8px;border:1px solid #ddd">{opp.get('nombre','-')}</td>
          <td style="padding:8px;border:1px solid #ddd;color:#16a34a;font-weight:bold">{retorno:.2f}%</td>
          <td style="padding:8px;border:1px solid #ddd">{opp.get('monto','-')}</td>
          <td style="padding:8px;border:1px solid #ddd">{opp.get('plazo','-')} días</td>
          <td style="padding:8px;border:1px solid #ddd">{opp.get('riesgo','-')}</td>
        </tr>"""

    return f"""
    <html><body style="font-family:Arial,sans-serif;margin:0;padding:20px">
      <h2 style="color:#1e40af">🔔 Prestamype — Oportunidades &gt; {MIN_RETURN}% anual</h2>
      <p>Se encontraron <strong>{len(opportunities)}</strong> oportunidad(es) con retorno anualizado
         mayor a <strong>{MIN_RETURN}%</strong>.</p>
      <table style="border-collapse:collapse;width:100%;margin-top:16px">
        <thead>
          <tr style="background:#1e40af;color:white">
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
        <a href="{OPPORTUNITIES_URL}"
           style="background:#1e40af;color:white;padding:10px 20px;text-decoration:none;border-radius:6px">
          Ver en Prestamype ➜
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
    plain += f"Ver: {OPPORTUNITIES_URL}\n\n"
    for opp in opportunities:
        retorno = float(opp.get("tasa_anual", 0))
        plain += f"- {opp.get('nombre','-')}: {retorno:.2f}% anual\n"

    msg.attach(MIMEText(plain, "plain"))
    msg.attach(MIMEText(build_email_html(opportunities), "html"))

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
        server.login(GMAIL_USER, GMAIL_APP_PASSWORD)
        server.sendmail(GMAIL_USER, ALERT_EMAIL, msg.as_string())

    print(f"✅ Email enviado a {ALERT_EMAIL} con {len(opportunities)} oportunidad(es).")


def main():
    missing = [v for v in ["PRESTAMYPE_EMAIL", "PRESTAMYPE_PASSWORD", "GMAIL_USER", "GMAIL_APP_PASSWORD"]
               if not os.environ.get(v)]
    if missing:
        print(f"❌ Variables faltantes: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)

    print(f"🔍 Iniciando monitoreo Prestamype... ({datetime.now().strftime('%H:%M UTC')})")

    opportunities = fetch_opportunities_with_browser()
    print(f"   {len(opportunities)} oportunidad(es) totales encontradas.")

    seen = load_seen_ids()
    filtered = [
        opp for opp in opportunities
        if float(opp.get("tasa_anual", 0)) > MIN_RETURN
        and str(opp.get("id", "")) not in seen
    ]

    print(f"   {len(filtered)} nueva(s) con retorno > {MIN_RETURN}%.")

    if filtered:
        send_email(filtered)
        seen.update(str(opp.get("id", "")) for opp in filtered)
        save_seen_ids(seen)
    else:
        print("   Sin nuevas oportunidades para alertar.")


if __name__ == "__main__":
    main()
