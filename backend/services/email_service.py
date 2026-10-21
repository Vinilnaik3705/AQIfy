"""Email dispatch and HTML email template formatting service."""

from __future__ import annotations

import os
import smtplib
from html import escape
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, Dict, Tuple, List, Any
import httpx

from services.guidance_service import (
    PROFILE_LABELS,
    POLLUTANT_INFO,
    _translate_text,
)


def _get_resend_key() -> Optional[str]:
    """Get Resend API key — checks multiple environment variable names for compatibility."""
    return (
        os.environ.get("RESEND_API_KEY")
        or os.environ.get("Resend")
        or os.environ.get("RESEND")
        or None
    )


get_resend_key = _get_resend_key


def _send_email(to_email: str, subject: str, html_body: str) -> bool:
    """Send an email using Brevo (if configured), SMTP (if configured), Resend (as fallback), or Console simulation."""
    # 1. Brevo HTTP API Dispatch
    brevo_key = os.environ.get("BREVO_API_KEY")
    if brevo_key:
        brevo_sender_email = os.environ.get("BREVO_SENDER_EMAIL") or os.environ.get("SMTP_USER")
        if brevo_sender_email:
            try:
                url = "https://api.brevo.com/v3/smtp/email"
                headers = {
                    "accept": "application/json",
                    "api-key": brevo_key,
                    "content-type": "application/json",
                }
                payload = {
                    "sender": {
                        "name": "AQI Alerts",
                        "email": brevo_sender_email,
                    },
                    "to": [{"email": to_email}],
                    "subject": subject,
                    "htmlContent": html_body,
                }
                resp = httpx.post(url, json=payload, headers=headers, timeout=10.0)
                if resp.status_code in (200, 201, 202):
                    print(f"[BREVO] Email successfully sent to {to_email} | Response: {resp.json()}")
                    return True
                else:
                    print(f"[BREVO] Failed to send email to {to_email}: {resp.status_code} | {resp.text}")
            except Exception as e:
                print(f"[BREVO] Failed to send email to {to_email}: {type(e).__name__}: {e}")

    # 2. SMTP Dispatch
    smtp_host = os.environ.get("SMTP_HOST")
    smtp_port = os.environ.get("SMTP_PORT")
    smtp_user = os.environ.get("SMTP_USER")
    smtp_pass = os.environ.get("SMTP_PASSWORD")
    smtp_from = os.environ.get("SMTP_FROM") or smtp_user

    if smtp_host and smtp_port and smtp_user and smtp_pass:
        try:
            msg = MIMEMultipart("alternative")
            msg["Subject"] = subject
            msg["From"] = smtp_from
            msg["To"] = to_email

            part = MIMEText(html_body, "html", "utf-8")
            msg.attach(part)

            port = int(smtp_port)
            if port == 465:
                server = smtplib.SMTP_SSL(smtp_host, port, timeout=10.0)
            else:
                server = smtplib.SMTP(smtp_host, port, timeout=10.0)
                server.starttls()

            server.login(smtp_user, smtp_pass)
            server.sendmail(smtp_from, [to_email], msg.as_string())
            server.quit()
            print(f"[SMTP] Email successfully sent to {to_email} | Subject: {subject}")
            return True
        except Exception as e:
            print(f"[SMTP] Failed to send email to {to_email}: {type(e).__name__}: {e}")

    # 3. Resend API Dispatch
    resend_key = _get_resend_key()
    if resend_key:
        from_email = os.environ.get("RESEND_FROM_EMAIL") or "AQI Alerts <onboarding@resend.dev>"
        try:
            import resend
            resend.api_key = resend_key
            result = resend.Emails.send({
                "from": from_email,
                "to": to_email,
                "subject": subject,
                "html": html_body,
            })
            print(f"[RESEND] Email successfully sent to {to_email} | Resend ID: {result}")
            return True
        except Exception as e:
            err_msg = str(e)
            print(f"[RESEND] Failed to send email to {to_email}: {type(e).__name__}: {err_msg}")

            if "onboarding@resend.dev" in from_email or "sandbox" in err_msg.lower() or "validation" in err_msg.lower():
                print(
                    "\n" + "=" * 85 + "\n"
                    f"DIAGNOSTIC WARNING: Resend API call failed when sending to: {to_email}\n"
                    f"If you are using Resend in Free/Sandbox mode (e.g. using onboarding@resend.dev),\n"
                    f"Resend RESTRICTS emails to ONLY your own registered account email address\n"
                    f"(vinilnaikdharavath3705@gmail.com).\n\n"
                    f"HOW TO SEND TO OTHER EMAILS:\n"
                    f"Option A: Add & verify a custom sending domain in your Resend dashboard, then set RESEND_FROM_EMAIL.\n"
                    f"Option B: Use SMTP by adding these to your backend/.env file:\n"
                    f"          SMTP_HOST=smtp.gmail.com\n"
                    f"          SMTP_PORT=587\n"
                    f"          SMTP_USER=your-email@gmail.com\n"
                    f"          SMTP_PASSWORD=your-app-password\n"
                    + "=" * 85 + "\n"
                )
            return False

    print(f"[CONSOLE EMAIL SIMULATION] No active mail sender config. To: {to_email} | Subject: {subject}")
    return False


send_email = _send_email


def _aqi_category_style(aqi: float) -> Dict[str, str]:
    """Map an AQI value to its category label + brand colors for the alert email."""
    if aqi > 300:
        return {"label": "Severe", "color": "#7f1d1d", "bg": "#fef2f2", "dot": "\U0001F7E4"}
    if aqi > 200:
        return {"label": "Very Poor", "color": "#b91c1c", "bg": "#fef2f2", "dot": "\U0001F534"}
    if aqi > 150:
        return {"label": "Poor", "color": "#ea580c", "bg": "#fff7ed", "dot": "\U0001F7E0"}
    if aqi > 100:
        return {"label": "Moderate", "color": "#ca8a04", "bg": "#fefce8", "dot": "\U0001F7E1"}
    if aqi > 50:
        return {"label": "Satisfactory", "color": "#65a30d", "bg": "#f7fee7", "dot": "\U0001F7E2"}
    return {"label": "Good", "color": "#16a34a", "bg": "#f0fdf4", "dot": "\U0001F7E2"}


aqi_category_style = _aqi_category_style


def _build_alert_email(
    city_name: str,
    current_aqi: float,
    profile: str,
    pollutants: Dict[str, float],
    trend_delta: float,
    dashboard_url: str,
    unsubscribe_url: str,
    guidance: list[str],
    lang: str = "en",
) -> Tuple[str, str]:
    """Build the branded, table-based (email-client-safe) alert email.
    Returns (subject, html_body)."""
    safe_city_name = escape(city_name)
    safe_dashboard_url = escape(dashboard_url, quote=True)
    safe_unsubscribe_url = escape(unsubscribe_url, quote=True)
    style = _aqi_category_style(current_aqi)
    style_label_translated = _translate_text(style["label"], lang)
    profile_label = PROFILE_LABELS.get(profile, profile.replace("_", " ").title())
    profile_label_translated = _translate_text(profile_label, lang)

    if trend_delta > 10:
        trend_label = _translate_text("rising", lang)
        trend_html = f'<span style="color:#b91c1c;">&#9650; {trend_label}</span>'
    elif trend_delta < -10:
        trend_label = _translate_text("falling", lang)
        trend_html = f'<span style="color:#16a34a;">&#9660; {trend_label}</span>'
    else:
        trend_label = _translate_text("steady", lang)
        trend_html = f'<span style="color:#64748b;">&#8212; {trend_label}</span>'

    personal_alert_title = _translate_text("Personal Air Quality Alert", lang)
    trend_since_text = _translate_text("Trend since last alert: ", lang)
    pollutant_breakdown_title = _translate_text("Pollutant breakdown", lang)
    what_this_means_title = _translate_text("What this means for you", lang)
    view_dashboard_btn = _translate_text("View Live Dashboard", lang)
    unsubscribe_info_text = escape(
        _translate_text(
            f"You're receiving this because you subscribed to alerts for {city_name} ({profile_label}).",
            lang,
        )
    )
    unsubscribe_btn_text = _translate_text("Unsubscribe from these alerts", lang)

    pollutant_cells = []
    for key, (label, safe_limit, unit) in POLLUTANT_INFO.items():
        val = pollutants.get(key)
        if val is None:
            continue

        display_val = val
        if key == "co" and val < 10.0:
            display_val = val * 1000.0

        exceeded = display_val > safe_limit
        val_color = "#b91c1c" if exceeded else "#1e293b"
        val_str = f"{display_val:.0f}" if (key == "co" or display_val.is_integer()) else f"{display_val:.1f}"
        safe_translated = _translate_text("safe", lang)

        pollutant_cells.append(f"""
        <td width="33%" style="padding:10px; text-align:center; border:1px solid #e2e8f0; border-radius:6px;">
          <div style="font-size:12px; color:#64748b; font-weight:600;">{label}</div>
          <div style="font-size:18px; font-weight:700; color:{val_color};">{val_str}</div>
          <div style="font-size:11px; color:#94a3b8;">{unit} &middot; {safe_translated} &lt; {safe_limit:g}</div>
        </td>""")

    pollutant_rows = "".join(
        f"<tr>{''.join(pollutant_cells[i:i+3])}</tr>"
        for i in range(0, len(pollutant_cells), 3)
    )

    guidance_html = "".join(
        f'<tr><td style="padding:6px 0; font-size:14px; color:#334155;">&#8226;&nbsp; {escape(tip)}</td></tr>'
        for tip in guidance
    )

    subject_alert_text = _translate_text(f"AQI Alert: {city_name} is {style['label']}", lang)
    subject = f"{style['dot']} {subject_alert_text} ({current_aqi:.0f})"

    html = f"""
    <div style="background:#f1f5f9; padding:24px 12px; font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:12px; overflow:hidden; border:1px solid #e2e8f0;">
        <tr>
          <td style="padding:20px 24px; background:#1e293b;">
            <span style="font-size:18px; font-weight:800; color:#ffffff;">AQIfy</span>
            <span style="font-size:12px; color:#94a3b8; margin-left:8px;">{personal_alert_title}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{style['bg']};">
              <tr>
                <td style="padding:24px; text-align:center;">
                  <div style="font-size:13px; color:#64748b; font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">{safe_city_name}</div>
                  <div style="font-size:48px; font-weight:800; color:{style['color']}; line-height:1.1; margin-top:4px;">{current_aqi:.0f}</div>
                  <div style="font-size:16px; font-weight:700; color:{style['color']};">{style['dot']} {style_label_translated}</div>
                  <div style="font-size:12px; color:#64748b; margin-top:4px;">{trend_since_text} {trend_html}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:22px 24px 4px;">
            <div style="font-size:13px; font-weight:700; color:#1e293b; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:10px;">{pollutant_breakdown_title}</div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="6">{pollutant_rows}</table>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 24px 4px;">
            <div style="font-size:13px; font-weight:700; color:#1e293b; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:8px;">
              {what_this_means_title} &mdash; {profile_label_translated}
            </div>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">{guidance_html}</table>
          </td>
        </tr>
        <tr>
          <td style="padding:24px; text-align:center;">
            <a href="{safe_dashboard_url}" style="display:inline-block; background:#3b82f6; color:#ffffff; padding:12px 28px; border-radius:8px; text-decoration:none; font-weight:700; font-size:14px;">{escape(view_dashboard_btn)}</a>
          </td>
        </tr>
        <tr>
          <td style="padding:24px; border-top:1px solid #e2e8f0; text-align:center; background:#f8fafc;">
            <div style="font-size:12px; color:#64748b; margin-bottom:12px; font-family:Arial,sans-serif;">
              {unsubscribe_info_text}
            </div>
            <div style="margin-top: 6px;">
              <a href="{safe_unsubscribe_url}" style="display:inline-block; border:1.5px solid #ef4444; color:#ef4444; background:#ffffff; padding:10px 20px; border-radius:6px; text-decoration:none; font-weight:700; font-size:13px; font-family:Arial,sans-serif;">
                {escape(unsubscribe_btn_text)}
              </a>
            </div>
          </td>
        </tr>
      </table>
    </div>
    """
    return subject, html


build_alert_email = _build_alert_email
