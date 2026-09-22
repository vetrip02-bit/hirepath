#!/usr/bin/env python3
"""Build the refined A4 HirePath flyer without changing its content."""

from pathlib import Path

from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

from create_promotional_flyer import (
    ASSETS,
    BLUE,
    BRIGHT_BLUE,
    FLYER_ASSETS,
    MID_BLUE,
    MINT,
    NAVY,
    PALE_BLUE,
    PALE_MINT,
    PALEST_BLUE,
    ROOT,
    SLATE,
    WHITE,
    cmyk,
    draw_icon,
    draw_lock,
    draw_qr,
    draw_rounded_rect,
    register_fonts,
    rgba_on_background,
)


TMP = ROOT / "tmp" / "pdfs"
OUTPUT = ROOT / "output" / "pdf" / "hirepath-promotional-flyer-a4-v2.pdf"

CARD_BORDER = cmyk("#D3E1F2")
CARD_SHADOW = cmyk("#E7EEF7")
HERO_PALE = cmyk("#EAF4FF")
TEAL_DARK = cmyk("#087A67")


def draw_feature_card_v2(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    icon: str,
    title: str,
    body: str,
    accent,
) -> None:
    # A restrained offset layer gives the cards depth without raster effects.
    draw_rounded_rect(c, x + 2.5, y - 3, w, h, 13, CARD_SHADOW)
    draw_rounded_rect(c, x, y, w, h, 13, WHITE, CARD_BORDER, 0.8)
    c.setFillColor(accent)
    c.roundRect(x, y + 13, 4.5, h - 26, 2.25, stroke=0, fill=1)

    draw_rounded_rect(c, x + 17, y + h - 53, 38, 38, 12, PALE_BLUE)
    draw_icon(c, icon, x + 26, y + h - 44, 20)

    c.setFillColor(NAVY)
    c.setFont("HirePath-Bold", 11.2)
    c.drawString(x + 67, y + h - 29, title)

    style = ParagraphStyle(
        "feature-v2",
        fontName="HirePath-Regular",
        fontSize=8.45,
        leading=11,
        textColor=SLATE,
        alignment=TA_LEFT,
        spaceAfter=0,
    )
    paragraph = Paragraph(body, style)
    _, ph = paragraph.wrap(w - 84, h - 41)
    paragraph.drawOn(c, x + 67, y + h - 42 - ph)


def create_refined_flyer() -> Path:
    register_fonts()
    TMP.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    hero_jpg = TMP / "hirepath-hero-cmyk-v2.jpg"
    logo_jpg = TMP / "hirepath-logo-cmyk-v2.jpg"
    rgba_on_background(
        FLYER_ASSETS / "hirepath-career-path-hero.png",
        hero_jpg,
        (1350, 1840),
        "#EAF4FF",
    )
    rgba_on_background(ASSETS / "hirepath-logo.png", logo_jpg, (1200, 399), "#FBFCFF")

    page_w, page_h = A4
    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    c.setTitle("HirePath A4 Promotional Flyer - Refined Edition")
    c.setAuthor("HirePath")
    c.setSubject("Refined print promotional flyer for the HirePath career-planning web application")

    c.setFillColor(cmyk("#FBFCFF"))
    c.rect(0, 0, page_w, page_h, stroke=0, fill=1)

    # Clean header with stronger left/right alignment.
    c.drawImage(ImageReader(str(logo_jpg)), 38, 790, width=118, height=39.2, preserveAspectRatio=True, mask="auto")
    draw_rounded_rect(c, 355, 793, 202, 25, 12.5, PALE_MINT)
    c.setFillColor(TEAL_DARK)
    c.setFont("HirePath-Bold", 8.2)
    c.drawCentredString(456, 801.6, "CAREER PLANNING, SIMPLIFIED")

    # Premium hero panel.
    draw_rounded_rect(c, 30, 500, 535, 274, 22, NAVY)
    c.setFillColor(cmyk("#16366E"))
    c.circle(88, 724, 34, stroke=0, fill=1)
    c.circle(315, 548, 32, stroke=0, fill=1)

    c.setFillColor(MINT)
    c.roundRect(52, 730, 46, 4, 2, stroke=0, fill=1)
    c.setFillColor(WHITE)
    c.setFont("HirePath-Bold", 27.4)
    c.drawString(52, 693, "YOUR JOB SEARCH.")
    c.drawString(52, 657, "ONE CLEAR PATH.")

    hero_style = ParagraphStyle(
        "hero-v2",
        fontName="HirePath-Regular",
        fontSize=11.6,
        leading=16,
        textColor=cmyk("#DCEBFF"),
    )
    hero_copy = Paragraph(
        "From first application to interview day, HirePath keeps every step organized - so you can move forward with confidence.",
        hero_style,
    )
    _, hero_h = hero_copy.wrap(272, 92)
    hero_copy.drawOn(c, 52, 623 - hero_h)

    # Layered art plate adds contrast and depth while preserving the original illustration.
    draw_rounded_rect(c, 353, 516, 197, 238, 18, cmyk("#0A1F4A"))
    draw_rounded_rect(c, 348, 521, 197, 238, 18, HERO_PALE)
    c.drawImage(ImageReader(str(hero_jpg)), 348, 521, width=197, height=238, preserveAspectRatio=False, mask="auto")

    c.setStrokeColor(MINT)
    c.setLineWidth(2)
    c.setDash(1.5, 5)
    path = c.beginPath()
    path.moveTo(304, 543)
    path.curveTo(320, 552, 326, 577, 344, 585)
    c.drawPath(path, stroke=1, fill=0)
    c.setDash()
    c.setFillColor(MINT)
    c.circle(304, 543, 3.2, stroke=0, fill=1)
    c.circle(344, 585, 3.2, stroke=0, fill=1)

    # Feature section with a clearer rhythm and tighter card hierarchy.
    c.setFillColor(NAVY)
    c.setFont("HirePath-Bold", 18)
    c.drawString(38, 458, "Everything you need to move forward")
    c.setFillColor(BRIGHT_BLUE)
    c.roundRect(38, 444, 58, 4, 2, stroke=0, fill=1)

    card_w, card_h = 250, 88
    draw_feature_card_v2(
        c,
        38,
        337,
        card_w,
        card_h,
        "briefcase",
        "Capture opportunities",
        "Paste a job ad, upload a photo, or enter the details manually.",
        BRIGHT_BLUE,
    )
    draw_feature_card_v2(
        c,
        307,
        337,
        card_w,
        card_h,
        "spark",
        "Prepare with purpose",
        "Build focused lessons, examples, interview tips, and quick quizzes.",
        MINT,
    )
    draw_feature_card_v2(
        c,
        38,
        235,
        card_w,
        card_h,
        "calendar",
        "Own today's plan",
        "Schedule tasks, track progress, and stay ahead of deadlines.",
        MINT,
    )
    draw_feature_card_v2(
        c,
        307,
        235,
        card_w,
        card_h,
        "search",
        "Learn in the moment",
        "Explore companies, skills, and industries with Quickwiki.",
        BRIGHT_BLUE,
    )

    # Privacy promise remains prominent but visually quieter than the CTA.
    draw_rounded_rect(c, 38, 184, 519, 38, 11, PALE_MINT, cmyk("#D2EEE6"), 0.7)
    draw_lock(c, 54, 194, 18, TEAL_DARK)
    c.setFillColor(TEAL_DARK)
    c.setFont("HirePath-Bold", 9.1)
    c.drawString(82, 203.3, "PRIVATE BY DESIGN")
    c.setFillColor(SLATE)
    c.setFont("HirePath-Regular", 9.1)
    c.drawString(186, 203.3, "Your profile and plans stay in your browser.")

    # High-contrast call to action with preserved wording and destination.
    draw_rounded_rect(c, 30, 31, 535, 139, 18, BLUE)
    c.setFillColor(MINT)
    c.roundRect(52, 155, 70, 4, 2, stroke=0, fill=1)
    c.setFillColor(MINT)
    c.setFont("HirePath-Bold", 9)
    c.drawString(52, 143, "START FREE IN YOUR BROWSER")
    c.setFillColor(WHITE)
    c.setFont("HirePath-Bold", 22.5)
    c.drawString(52, 112, "Build your path today.")
    c.setFont("HirePath-Regular", 10.4)
    c.drawString(52, 89, "Scan to open HirePath - no download required.")
    c.setFillColor(cmyk("#DCEBFF"))
    c.setFont("HirePath-Regular", 7.6)
    c.drawString(52, 63, "heartfelt-hotteok-cab423.netlify.app")

    draw_rounded_rect(c, 459, 47, 86, 86, 10, WHITE)
    draw_qr(c, 466, 54, 72)

    c.showPage()
    c.save()
    return OUTPUT


if __name__ == "__main__":
    print(create_refined_flyer())
