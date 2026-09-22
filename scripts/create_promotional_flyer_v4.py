#!/usr/bin/env python3
"""Build an alternate editorial-style A4 HirePath flyer."""

from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
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
OUTPUT = ROOT / "output" / "pdf" / "hirepath-promotional-flyer-a4-v4-editorial.pdf"

CREAM = cmyk("#F7F4EE")
PAPER = cmyk("#FFFDF9")
WARM_SHADOW = cmyk("#E8E3DA")
CARD_BORDER = cmyk("#D9E2EE")
TEAL_DARK = cmyk("#087A67")
SOFT_BLUE = cmyk("#EAF4FF")
SOFT_TEXT = cmyk("#DCE9FB")


def register_display_font() -> None:
    register_fonts()
    pdfmetrics.registerFont(
        TTFont(
            "HirePath-Display",
            "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf",
        )
    )


def draw_editorial_card(
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
    draw_rounded_rect(c, x + 3, y - 3, w, h, 12, WARM_SHADOW)
    draw_rounded_rect(c, x, y, w, h, 12, PAPER, CARD_BORDER, 0.75)

    c.setFillColor(accent)
    c.rect(x, y + h - 7, w, 7, stroke=0, fill=1)
    draw_rounded_rect(c, x + 17, y + 20, 40, 40, 12, PALE_BLUE)
    draw_icon(c, icon, x + 27, y + 30, 20)

    c.setFillColor(NAVY)
    c.setFont("HirePath-Bold", 11.1)
    c.drawString(x + 69, y + h - 31, title)

    style = ParagraphStyle(
        "editorial-card",
        fontName="HirePath-Regular",
        fontSize=8.45,
        leading=11,
        textColor=SLATE,
        alignment=TA_LEFT,
        spaceAfter=0,
    )
    paragraph = Paragraph(body, style)
    _, ph = paragraph.wrap(w - 84, h - 42)
    paragraph.drawOn(c, x + 69, y + h - 45 - ph)


def create_editorial_flyer():
    register_display_font()
    TMP.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    hero_jpg = TMP / "hirepath-hero-cmyk-v4.jpg"
    logo_jpg = TMP / "hirepath-logo-cmyk-v4.jpg"
    rgba_on_background(
        FLYER_ASSETS / "hirepath-career-path-hero.png",
        hero_jpg,
        (1350, 1840),
        "#EAF4FF",
    )
    rgba_on_background(ASSETS / "hirepath-logo.png", logo_jpg, (1200, 399), "#F7F4EE")

    page_w, page_h = A4
    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    c.setTitle("HirePath A4 Promotional Flyer - Editorial Style")
    c.setAuthor("HirePath")
    c.setSubject("Alternate editorial-style promotional flyer for HirePath")

    c.setFillColor(CREAM)
    c.rect(0, 0, page_w, page_h, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.rect(0, 0, 17, page_h, stroke=0, fill=1)
    c.setFillColor(MINT)
    c.rect(10, 690, 7, 78, stroke=0, fill=1)
    c.rect(10, 142, 7, 62, stroke=0, fill=1)

    # Header.
    c.drawImage(ImageReader(str(logo_jpg)), 43, 791, width=118, height=39.2, preserveAspectRatio=True, mask="auto")
    draw_rounded_rect(c, 351, 793, 203, 25, 12.5, PALE_MINT)
    c.setFillColor(TEAL_DARK)
    c.setFont("HirePath-Bold", 8.2)
    c.drawCentredString(452.5, 801.6, "CAREER PLANNING, SIMPLIFIED")

    # Editorial hero with a rotated cobalt mat behind the unchanged illustration.
    c.setFillColor(NAVY)
    c.setFont("HirePath-Display", 38)
    c.drawString(46, 719, "YOUR JOB SEARCH.")
    c.setFillColor(BLUE)
    c.drawString(46, 678, "ONE CLEAR PATH.")

    c.setFillColor(MINT)
    c.rect(47, 653, 76, 4, stroke=0, fill=1)

    hero_style = ParagraphStyle(
        "editorial-hero",
        fontName="HirePath-Regular",
        fontSize=11.5,
        leading=16,
        textColor=SLATE,
    )
    hero_copy = Paragraph(
        "From first application to interview day, HirePath keeps every step organized - so you can move forward with confidence.",
        hero_style,
    )
    _, hero_h = hero_copy.wrap(260, 92)
    hero_copy.drawOn(c, 47, 628 - hero_h)

    c.saveState()
    c.translate(448, 650)
    c.rotate(-5)
    draw_rounded_rect(c, -105, -122, 210, 244, 18, BLUE)
    c.restoreState()
    draw_rounded_rect(c, 342, 525, 207, 244, 16, SOFT_BLUE)
    c.drawImage(ImageReader(str(hero_jpg)), 342, 525, width=207, height=244, preserveAspectRatio=False, mask="auto")
    c.setFillColor(MINT)
    c.circle(529, 753, 18, stroke=0, fill=1)
    c.setFillColor(CREAM)
    c.circle(529, 753, 9, stroke=0, fill=1)

    # Feature section.
    c.setFillColor(NAVY)
    c.setFont("HirePath-Display", 24)
    c.drawString(46, 495, "Everything you need to move forward")
    c.setFillColor(BRIGHT_BLUE)
    c.rect(47, 482, 58, 4, stroke=0, fill=1)

    draw_editorial_card(
        c,
        46,
        374,
        243,
        90,
        "briefcase",
        "Capture opportunities",
        "Paste a job ad, upload a photo, or enter the details manually.",
        BRIGHT_BLUE,
    )
    draw_editorial_card(
        c,
        307,
        374,
        243,
        90,
        "spark",
        "Prepare with purpose",
        "Build focused lessons, examples, interview tips, and quick quizzes.",
        MINT,
    )
    draw_editorial_card(
        c,
        46,
        272,
        243,
        90,
        "calendar",
        "Own today's plan",
        "Schedule tasks, track progress, and stay ahead of deadlines.",
        MINT,
    )
    draw_editorial_card(
        c,
        307,
        272,
        243,
        90,
        "search",
        "Learn in the moment",
        "Explore companies, skills, and industries with Quickwiki.",
        BRIGHT_BLUE,
    )

    # Privacy statement.
    draw_rounded_rect(c, 46, 220, 504, 37, 10, PALE_MINT)
    draw_lock(c, 61, 230, 18, TEAL_DARK)
    c.setFillColor(TEAL_DARK)
    c.setFont("HirePath-Bold", 9.1)
    c.drawString(90, 239.3, "PRIVATE BY DESIGN")
    c.setFillColor(SLATE)
    c.setFont("HirePath-Regular", 9.1)
    c.drawString(194, 239.3, "Your profile and plans stay in your browser.")

    # Editorial CTA with a diagonal cobalt panel.
    draw_rounded_rect(c, 30, 31, 535, 164, 18, NAVY)
    c.setFillColor(BLUE)
    panel = c.beginPath()
    panel.moveTo(444, 43)
    panel.lineTo(551, 43)
    panel.lineTo(551, 183)
    panel.lineTo(474, 183)
    panel.close()
    c.drawPath(panel, stroke=0, fill=1)

    c.setFillColor(MINT)
    c.rect(51, 170, 74, 4, stroke=0, fill=1)
    c.setFont("HirePath-Bold", 9)
    c.drawString(51, 155, "START FREE IN YOUR BROWSER")
    c.setFillColor(WHITE)
    c.setFont("HirePath-Bold", 23)
    c.drawString(51, 121, "Build your path today.")
    c.setFont("HirePath-Regular", 10.4)
    c.drawString(51, 96, "Scan to open HirePath - no download required.")
    c.setFillColor(SOFT_TEXT)
    c.setFont("HirePath-Regular", 7.6)
    c.drawString(51, 66, "heartfelt-hotteok-cab423.netlify.app")

    draw_rounded_rect(c, 460, 59, 85, 85, 10, WHITE)
    draw_qr(c, 466.5, 65.5, 72)

    c.showPage()
    c.save()
    return OUTPUT


if __name__ == "__main__":
    print(create_editorial_flyer())
