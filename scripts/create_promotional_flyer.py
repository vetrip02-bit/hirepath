#!/usr/bin/env python3
"""Build the A4 HirePath promotional flyer as a print-ready CMYK PDF."""

from pathlib import Path

from PIL import Image
from reportlab.graphics import renderPDF
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib.colors import CMYKColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
FLYER_ASSETS = ASSETS / "flyer"
TMP = ROOT / "tmp" / "pdfs"
OUTPUT = ROOT / "output" / "pdf" / "hirepath-promotional-flyer-a4.pdf"

APP_URL = "https://heartfelt-hotteok-cab423.netlify.app/#/dashboard"


def cmyk(hex_color: str) -> CMYKColor:
    """Convert an sRGB hex color to process CMYK."""
    value = hex_color.lstrip("#")
    r, g, b = (int(value[i : i + 2], 16) / 255 for i in (0, 2, 4))
    k = 1 - max(r, g, b)
    if k >= 0.999:
        return CMYKColor(0, 0, 0, 1)
    c = (1 - r - k) / (1 - k)
    m = (1 - g - k) / (1 - k)
    y = (1 - b - k) / (1 - k)
    return CMYKColor(c, m, y, k)


NAVY = cmyk("#0B2559")
BLUE = cmyk("#086DD8")
BRIGHT_BLUE = cmyk("#0A84FF")
PALE_BLUE = cmyk("#EEF6FF")
PALEST_BLUE = cmyk("#F7FAFE")
MID_BLUE = cmyk("#A9D4FF")
SLATE = cmyk("#465C7C")
MINT = cmyk("#1FC7A1")
PALE_MINT = cmyk("#E9FAF5")
WHITE = CMYKColor(0, 0, 0, 0)


def register_fonts() -> None:
    regular = "/System/Library/Fonts/Supplemental/Arial.ttf"
    bold = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
    pdfmetrics.registerFont(TTFont("HirePath-Regular", regular))
    pdfmetrics.registerFont(TTFont("HirePath-Bold", bold))


def rgba_on_background(source: Path, destination: Path, size: tuple[int, int], bg: str) -> None:
    """Place an image on a solid background and save it as a CMYK JPEG."""
    image = Image.open(source).convert("RGBA")
    plate = Image.new("RGBA", size, bg)
    scale = min((size[0] * 0.94) / image.width, (size[1] * 0.96) / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    x = (size[0] - resized.width) // 2
    y = (size[1] - resized.height) // 2
    plate.alpha_composite(resized, (x, y))
    plate.convert("RGB").convert("CMYK").save(destination, "JPEG", quality=96, subsampling=0)


def draw_rounded_rect(c: canvas.Canvas, x: float, y: float, w: float, h: float, radius: float, fill, stroke=None, width=1) -> None:
    c.setFillColor(fill)
    if stroke is None:
        c.setStrokeColor(fill)
    else:
        c.setStrokeColor(stroke)
    c.setLineWidth(width)
    c.roundRect(x, y, w, h, radius, stroke=1 if stroke else 0, fill=1)


def draw_lock(c: canvas.Canvas, x: float, y: float, size: float, color) -> None:
    c.setStrokeColor(color)
    c.setFillColor(color)
    c.setLineWidth(max(1, size * 0.08))
    c.roundRect(x + size * 0.18, y, size * 0.64, size * 0.52, size * 0.08, stroke=1, fill=0)
    c.arc(x + size * 0.28, y + size * 0.30, x + size * 0.72, y + size * 0.85, 0, 180)
    c.circle(x + size * 0.50, y + size * 0.24, size * 0.055, stroke=0, fill=1)


def draw_icon(c: canvas.Canvas, kind: str, x: float, y: float, size: float) -> None:
    c.setStrokeColor(BLUE)
    c.setFillColor(BLUE)
    c.setLineCap(1)
    c.setLineJoin(1)
    c.setLineWidth(1.6)
    if kind == "briefcase":
        c.roundRect(x + 2, y + 4, size - 4, size - 9, 2.2, stroke=1, fill=0)
        c.roundRect(x + size * 0.35, y + size * 0.71, size * 0.30, size * 0.16, 1.2, stroke=1, fill=0)
        c.line(x + 2, y + size * 0.48, x + size - 2, y + size * 0.48)
        c.line(x + size * 0.45, y + size * 0.43, x + size * 0.55, y + size * 0.43)
    elif kind == "spark":
        c.line(x + size * 0.50, y + 2, x + size * 0.50, y + size - 2)
        c.line(x + 2, y + size * 0.50, x + size - 2, y + size * 0.50)
        c.line(x + size * 0.18, y + size * 0.18, x + size * 0.82, y + size * 0.82)
        c.line(x + size * 0.18, y + size * 0.82, x + size * 0.82, y + size * 0.18)
        c.circle(x + size * 0.50, y + size * 0.50, size * 0.16, stroke=1, fill=0)
    elif kind == "calendar":
        c.roundRect(x + 2, y + 3, size - 4, size - 6, 2.4, stroke=1, fill=0)
        c.line(x + 2, y + size * 0.66, x + size - 2, y + size * 0.66)
        c.line(x + size * 0.31, y + size * 0.75, x + size * 0.31, y + size * 0.93)
        c.line(x + size * 0.69, y + size * 0.75, x + size * 0.69, y + size * 0.93)
        c.line(x + size * 0.31, y + size * 0.36, x + size * 0.44, y + size * 0.23)
        c.line(x + size * 0.44, y + size * 0.23, x + size * 0.72, y + size * 0.51)
    elif kind == "search":
        c.circle(x + size * 0.43, y + size * 0.58, size * 0.28, stroke=1, fill=0)
        c.line(x + size * 0.63, y + size * 0.37, x + size * 0.88, y + size * 0.12)
        c.line(x + size * 0.32, y + size * 0.58, x + size * 0.54, y + size * 0.58)
        c.line(x + size * 0.43, y + size * 0.47, x + size * 0.43, y + size * 0.69)


def draw_feature_card(c: canvas.Canvas, x: float, y: float, w: float, h: float, icon: str, title: str, body: str) -> None:
    draw_rounded_rect(c, x, y, w, h, 12, PALEST_BLUE, cmyk("#D7E7F8"), 0.8)
    draw_rounded_rect(c, x + 15, y + h - 49, 36, 36, 11, PALE_BLUE)
    draw_icon(c, icon, x + 23, y + h - 41, 20)

    c.setFillColor(NAVY)
    c.setFont("HirePath-Bold", 11.2)
    c.drawString(x + 62, y + h - 28, title)

    style = ParagraphStyle(
        "feature",
        fontName="HirePath-Regular",
        fontSize=8.6,
        leading=11.3,
        textColor=SLATE,
        alignment=TA_LEFT,
        spaceAfter=0,
    )
    p = Paragraph(body, style)
    _, ph = p.wrap(w - 77, h - 41)
    p.drawOn(c, x + 62, y + h - 40 - ph)


def draw_qr(c: canvas.Canvas, x: float, y: float, size: float) -> None:
    qr = QrCodeWidget(APP_URL)
    qr.barFillColor = NAVY
    qr.barStrokeColor = NAVY
    qr.barBorder = 1
    bounds = qr.getBounds()
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    drawing = Drawing(size, size, transform=[size / width, 0, 0, size / height, 0, 0])
    drawing.add(qr)
    renderPDF.draw(drawing, c, x, y)


def create_flyer() -> Path:
    register_fonts()
    TMP.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    hero_jpg = TMP / "hirepath-hero-cmyk.jpg"
    logo_jpg = TMP / "hirepath-logo-cmyk.jpg"
    rgba_on_background(
        FLYER_ASSETS / "hirepath-career-path-hero.png",
        hero_jpg,
        (1350, 1840),
        "#EEF6FF",
    )
    rgba_on_background(ASSETS / "hirepath-logo.png", logo_jpg, (1200, 399), "#FFFFFF")

    page_w, page_h = A4
    c = canvas.Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    c.setTitle("HirePath A4 Promotional Flyer")
    c.setAuthor("HirePath")
    c.setSubject("Print promotional flyer for the HirePath career-planning web application")

    c.setFillColor(WHITE)
    c.rect(0, 0, page_w, page_h, stroke=0, fill=1)

    # Top brand lockup.
    c.drawImage(ImageReader(str(logo_jpg)), 38, 783, width=118, height=39.2, preserveAspectRatio=True, mask="auto")
    draw_rounded_rect(c, 38, 744, 164, 24, 12, PALE_MINT)
    c.setFillColor(cmyk("#087A67"))
    c.setFont("HirePath-Bold", 8.2)
    c.drawCentredString(120, 752.3, "CAREER PLANNING, SIMPLIFIED")

    # Hero message.
    c.setFillColor(NAVY)
    c.setFont("HirePath-Bold", 28.5)
    c.drawString(38, 708, "YOUR JOB SEARCH.")
    c.setFillColor(BLUE)
    c.drawString(38, 673, "ONE CLEAR PATH.")

    hero_style = ParagraphStyle(
        "hero",
        fontName="HirePath-Regular",
        fontSize=12.6,
        leading=17.2,
        textColor=SLATE,
    )
    hero_copy = Paragraph(
        "From first application to interview day, HirePath keeps every step organized - so you can move forward with confidence.",
        hero_style,
    )
    _, hero_h = hero_copy.wrap(278, 85)
    hero_copy.drawOn(c, 38, 644 - hero_h)

    # Hero art plate and decorative path dots.
    draw_rounded_rect(c, 343, 514, 214, 286, 24, PALE_BLUE)
    c.drawImage(ImageReader(str(hero_jpg)), 343, 514, width=214, height=286, preserveAspectRatio=False, mask="auto")
    c.setFillColor(MINT)
    for dx, dy, radius in [(327, 535, 3.2), (318, 550, 2.3), (313, 566, 1.7)]:
        c.circle(dx, dy, radius, stroke=0, fill=1)

    # Feature grid.
    c.setFillColor(NAVY)
    c.setFont("HirePath-Bold", 17.5)
    c.drawString(38, 478, "Everything you need to move forward")
    c.setFillColor(BRIGHT_BLUE)
    c.rect(38, 466, 42, 3, stroke=0, fill=1)

    card_w, card_h = 252, 92
    draw_feature_card(
        c,
        38,
        356,
        card_w,
        card_h,
        "briefcase",
        "Capture opportunities",
        "Paste a job ad, upload a photo, or enter the details manually.",
    )
    draw_feature_card(
        c,
        305,
        356,
        card_w,
        card_h,
        "spark",
        "Prepare with purpose",
        "Build focused lessons, examples, interview tips, and quick quizzes.",
    )
    draw_feature_card(
        c,
        38,
        248,
        card_w,
        card_h,
        "calendar",
        "Own today's plan",
        "Schedule tasks, track progress, and stay ahead of deadlines.",
    )
    draw_feature_card(
        c,
        305,
        248,
        card_w,
        card_h,
        "search",
        "Learn in the moment",
        "Explore companies, skills, and industries with Quickwiki.",
    )

    # Privacy promise.
    draw_rounded_rect(c, 38, 193, 519, 37, 10, PALE_MINT)
    draw_lock(c, 53, 202, 18, cmyk("#087A67"))
    c.setFillColor(cmyk("#087A67"))
    c.setFont("HirePath-Bold", 9.1)
    c.drawString(80, 211.8, "PRIVATE BY DESIGN")
    c.setFillColor(SLATE)
    c.setFont("HirePath-Regular", 9.1)
    c.drawString(184, 211.8, "Your profile and plans stay in your browser.")

    # Call to action.
    draw_rounded_rect(c, 30, 31, 535, 139, 18, NAVY)
    c.setFillColor(MINT)
    c.setFont("HirePath-Bold", 9)
    c.drawString(52, 143, "START FREE IN YOUR BROWSER")
    c.setFillColor(WHITE)
    c.setFont("HirePath-Bold", 22.5)
    c.drawString(52, 112, "Build your path today.")
    c.setFont("HirePath-Regular", 10.4)
    c.drawString(52, 89, "Scan to open HirePath - no download required.")
    c.setFillColor(MID_BLUE)
    c.setFont("HirePath-Regular", 7.6)
    c.drawString(52, 63, "heartfelt-hotteok-cab423.netlify.app")

    draw_rounded_rect(c, 461, 49, 84, 84, 9, WHITE)
    draw_qr(c, 467, 55, 72)

    c.showPage()
    c.save()
    return OUTPUT


if __name__ == "__main__":
    print(create_flyer())
