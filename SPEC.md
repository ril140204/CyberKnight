# CyberKnight Website

## Concept
"Hiệp Sĩ Mạng bảo vệ Vương Quốc Số" - Educational cybersecurity game for children.

## Design Language

### Aesthetic Direction
Neo-Brutalism meets Glassmorphism with Cyberpunk/Sci-Fi elements. Child-friendly, non-violent, vibrant yet safe for young eyes.

### Color Palette
- **Primary (Safety Blue)**: #00d4ff - Trust, technology, safety
- **Secondary (Cyber Purple)**: #8b5cf6 - Mystery, digital space
- **Accent (Neon Orange)**: #ff6b35 - Energy, action buttons
- **Accent (Neon Yellow)**: #fbbf24 - Highlights, rewards
- **Background Dark**: #0f172a - Main background
- **Background Secondary**: #1e293b - Cards, elevated surfaces
- **Text Primary**: #f8fafc
- **Text Secondary**: #94a3b8

### Typography
- **Headings**: Orbitron (Google Font) - Futuristic, tech feel
- **Body**: Inter (Google Font) - Clean, readable
- **Fallbacks**: system-ui, sans-serif

### Motion Philosophy
- Smooth scroll-triggered animations (fade-in, slide-in)
- Hover glow effects like high-tech devices
- 3D tilt effects on cards
- Floating animations for hero imagery
- Particle/grid background effects
- Shimmer/scanline effects on CTAs

## Layout & Structure

### Header
- Logo with animated neon glow
- Navigation: Trang chủ, Highlight, Sự kiện, Cập nhật, Diễn đàn
- CTA button styled as energy shield activation

### Hero Section
- Split layout: Text left, 3D mockup right
- Animated neon title with text-glow
- Shimmer effect on CTA button
- Cyber grid background with particles
- Slide-in animation on load

### Cyber Highlights
- 3D cards with tilt hover effect
- Gradient neon border glow on hover
- Icon + title + description format

### Timeline/Updates
- Tech-style vertical timeline
- Glowing nodes and connection lines
- Scroll-triggered reveals

### Forum Section
- Sci-fi dashboard aesthetic
- Search bar with glowing icon
- Category sidebar with badges
- Post list with hover effects
- "New Post" button as system activation

## Features & Interactions

### Animations
- Page load: Elements slide in from left/right/bottom
- Scroll: Fade-in and translate based on viewport
- Hover: Glow intensification, scale, tilt (3D effect)
- Buttons: Shimmer scanline effect
- Background: Slow-moving cyber grid

### Forum Features
- Category filtering
- Search functionality (UI only)
- Post preview on hover
- Badge counts for new posts
- Create post modal trigger

## Technical Approach
- Single HTML file with embedded CSS and JS
- Tailwind CSS via CDN for utility classes
- Custom CSS for special effects
- Vanilla JavaScript for animations
- IntersectionObserver for scroll effects
- CSS transforms for 3D effects
