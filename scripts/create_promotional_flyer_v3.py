#!/usr/bin/env python3
"""Build a further-refined A4 HirePath flyer with identical content."""

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
    MINT,
    NAVY,
    PALE_BLUE,
    PALE_MINT,
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
OUTPUT = ROOT / "output" / "pdf" / "hirepath-promotional-flyer-a4-v3.pdf"

PAGE_BG = cmyk("#F9FBFE")
CARD_BLUE = cmyk("#F2F7FD")
CARD_MINT = cmyk("#F1FAF7")
CARD_BORDER = cmyk("#D4E1F1")
CARD_SHADOW = cmyk("#E7EDF6")
HERO_PALE = cmyk("#EAF4FF")
TEAL_DARK = cmyk("#087A67")
SOFT_TEXT = cmyk("#DCE9FB")


def draw_feature_card_v3(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    icon: str,
    title: str,
    body: str,
    fill,
    accent,
) -> None:
    draw_rounded_rect(c, x + 3, y - 3, w, h, 14, CARD_SHADOW)
    draw_rounded_rect(c, x, y, w, h, 14, fill, CARD_BORDER, 0.8)

    c.setFillColor(accent)
    c.roundRect(x + 16, y + h - 20, 42, 4, 2, stroke=0, fill=1)

    draw_rounded_rect(c, x + 17, y + 19, 40, 40, 13, WHITE, cmyk("#DCE7F5"), 0.6)
    draw_icon(c, icon, x + 27, y + 29, 20)

    c.setFillColor(NAVY)
    c.setFont("HirePath-Bold", 11.2)
    c.drawString(x + 69, y + h - 30, title)

    style = ParagraphStyle(
        "feature-v3",
        fontName="HirePath-Regular",
        fontSize=8.5,
        leading=11.1,
        textColor=SLATE,
        alignment=TA_LEFT,
        spaceAfter=0,
    )
    paragraph = Paragraph(body, style)
    _, ph = paragraph.wrap(w - 86, h - 40)
    paragraph.drawOn(c, x + 69, y + h - 43 - ph)


def create_polished_flyer() -> Path:
    register_fonts()
    TMP.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    hero_jpg = TMP / "hirepath-hero-cmyk-v3.jpg"
    logo_jpg = TMP / "hirepath-logo-cmyk-v3.jpg"
    rgba_on_background(
        FLYER_ASSETS / "hirepath-career-path-hero.png",
        hero_jpg,
        (1350, 1840),
        "#EAF4FF",
    )
    rgba_on_background(ASSETS / "hirepath-logo.png", logo_jpg, (1200, 399), "#F9FBFE")

    page_w, page_h = A4
    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    c.setTitle("HirePath A4 Promotional Flyer - Polished Edition")
    c.setAuthor("HirePath")
    c.setSubject("Polished print promotional flyer for the HirePath career-planning web application")

    c.setFillColor(PAGE_BG)
    c.rect(0, 0, page_w, page_h, stroke=0, fill=1)

    # Header.
    c.drawImage(ImageReader(str(logo_jpg)), 38, 790, width=118, height=39.2, preserveAspectRatio=True, mask="auto")
    draw_rounded_rect(c, 355, 793, 202, 25, 12.5, PALE_MINT)
    c.setFillColor(TEAL_DARK)
    c.setFont("HirePath-Bold", 8.2)
    c.drawCentredString(456, 801.6, "CAREER PLANNING, SIMPLIFIED")

    # Hero: a strong split composition with the original art unchanged.
    draw_rounded_rect(c, 34, 498, 527, 270, 22, CARD_SHADOW)
    draw_rounded_rect(c, 30, 504, 535, 270, 22, NAVY)
    c.setFillColor(cmyk("#17366C"))
    c.circle(70, 732, 40, stroke=0, fill=1)
    c.circle(302, 544, 28, stroke=0, fill=1)

    c.setFillColor(MINT)
    c.roundRect(52, 731, 48, 4, 2, stroke=0, fill=1)
    c.setFillColor(WHITE)
    c.setFont("HirePath-Bold", 27.5)
    c.drawString(52, 693, "YOUR JOB SEARCH.")
    c.drawString(52, 657, "ONE CLEAR PATH.")

    hero_style = ParagraphStyle(
        "hero-v3",
        fontName="HirePath-Regular",
        fontSize=11.5,
        leading=15.8,
        textColor=SOFT_TEXT,
    )
    hero_copy = Paragraph(
        "From first application to interview day, HirePath keeps every step organized - so you can move forward with confidence.",
        hero_style,
    )
    _, hero_h = hero_copy.wrap(267, 91)
    hero_copy.drawOn(c, 52, 623 - hero_h)

    c.setFillColor(MINT)
    c.roundRect(334, 531, 3, 211, 1.5, stroke=0, fill=1)
    draw_rounded_rect(c, 347, 518, 203, 242, 17, HERO_PALE)
    c.drawImage(ImageReader(str(hero_jpg)), 347, 518, width=203, height=242, preserveAspectRatio=False, mask="auto")

    # Minimal path motif connects the message to the illustration.
    c.setStrokeColor(BRIGHT_BLUE)
    c.setLineWidth(1.8)
    c.setDash(1.5, 4.5)
    path = c.beginPath()
    path.moveTo(291, 543)
    path.curveTo(309, 555, 315, 580, 334, 590)
    c.drawPath(path, stroke=1, fill=0)
    c.setDash()
    c.setFillColor(MINT)
    c.circle(291, 543, 3.1, stroke=0, fill=1)
    c.circle(334, 590, 3.1, stroke=0, fill=1)

    # Feature heading and cards.
    c.setFillColor(NAVY)
    c.setFont("HirePath-Bold", 18.2)
    c.drawString(38, 461, "Everything you need to move forward")
    c.setFillColor(BRIGHT_BLUE)
    c.roundRect(38, 447, 60, 4, 2, stroke=0, fill=1)

    card_w, card_h = 250, 88
    draw_feature_card_v3(
        c,
        38,
        340,
        card_w,
        card_h,
        "briefcase",
        "Capture opportunities",
        "Paste a job ad, upload a photo, or enter the details manually.",
        CARD_BLUE,
        BRIGHT_BLUE,
    )
    draw_feature_card_v3(
        c,
        307,
        340,
        card_w,
        card_h,
        "spark",
        "Prepare with purpose",
        "Build focused lessons, examples, interview tips, and quick quizzes.",
        CARD_MINT,
        MINT,
    )
    draw_feature_card_v3(
        c,
        38,
        238,
        card_w,
        card_h,
        "calendar",
        "Own today's plan",
        "Schedule tasks, track progress, and stay ahead of deadlines.",
        CARD_MINT,
        MINT,
    )
    draw_feature_card_v3(
        c,
        307,
        238,
        card_w,
        card_h,
        "search",
        "Learn in the moment",
        "Explore companies, skills, and industries with Quickwiki.",
        CARD_BLUE,
        BRIGHT_BLUE,
    )

    # Privacy promise.
    draw_rounded_rect(c, 38, 186, 519, 38, 11, WHITE, cmyk("#CFE8E1"), 0.8)
    c.setFillColor(PALE_MINT)
    c.roundRect(39, 187, 44, 36, 10, stroke=0, fill=1)
    draw_lock(c, 52, 196, 18, TEAL_DARK)
    c.setFillColor(TEAL_DARK)
    c.setFont("HirePath-Bold", 9.1)
    c.drawString(94, 205.3, "PRIVATE BY DESIGN")
    c.setFillColor(SLATE)
    c.setFont("HirePath-Regular", 9.1)
    c.drawString(198, 205.3, "Your profile and plans stay in your browser.")

    # CTA: navy for premium contrast, with a blue QR panel.
    draw_rounded_rect(c, 30, 31, 535, 141, 18, NAVY)
    draw_rounded_rect(c, 434, 31, 131, 141, 18, BLUE)
    c.setFillColor(MINT)
    c.roundRect(52, 151, 72, 4, 2, stroke=0, fill=1)
    c.setFont("HirePath-Bold", 9)
    c.drawString(52, 137, "START FREE IN YOUR BROWSER")
    c.setFillColor(WHITE)
    c.setFont("HirePath-Bold", 22.5)
    c.drawString(52, 107, "Build your path today.")
    c.setFont("HirePath-Regular", 10.4)
    c.drawString(52, 84, "Scan to open HirePath - no download required.")
    c.setFillColor(SOFT_TEXT)
    c.setFont("HirePath-Regular", 7.6)
    c.drawString(52, 59, "heartfelt-hotteok-cab423.netlify.app")

    draw_rounded_rect(c, 459, 47, 86, 86, 10, WHITE)
    draw_qr(c, 466, 54, 72)

    c.showPage()
    c.save()
    return OUTPUT


if __name__ == "__main__":
    print(create_polished_flyer())
