---
# Aerial Edge homepage — the Sveltia-editable singleton (task #210, 2026-05-17).
#
# Schema: astro/src/content.config.ts → `homepage` collection.
# Sveltia config: astro/public/admin/config.yml → "Homepage" files-collection.
# Renderer: astro/src/pages/index.astro (consumes this entry).
#
# This file is the SOLE entry. Sveltia mounts it as a singleton — no
# create/delete in the admin. Mark edits this entry; Sveltia commits to main;
# deploy-prod.yml ships the change in ~2-3 min.
#
# Seeded byte-equivalent with the pre-#210 hardcoded homepage. Field-for-field
# parity with src/pages/index.astro@c18b5f6.

hero:
  small_title: "Glasgow's circus school "
  title_lines:
    - "Circus fitness"
    - "Circus training"
    - "Circus arts"
  cta_buttons:
    - { text: "Book a class",      url: "https://goteamup.com/p/3751555-aerial-edge/",                 target: "_blank" }
    - { text: "Event Tickets",     url: "https://www.tickettailor.com/events/aerialedgecircusschoolcic/", target: "_blank" }
    - { text: "Clothing Store",    url: "https://store.aerialedge.co.uk",                              target: "_blank" }
  body_html: >
    We have fun classes for all abilities, from toddlers to pensioners, and professional training too. Aerial Edge is a not-for-profit organisation, with sponsored places for people who experience barriers to participation.
    <a href="/index.html#contact">Sign up for our newsletter </a>to keep up with our ever-evolving schedule.
  video_src: "/assets/images/@stock/Hero2.mp4"

about:
  small_title: "Developing people"
  title: "Developing people through circus is what we do best."
  body: "Anyone can do circus, regardless of age, body type, experience or other factors. We start where you are now, then build from there. And there’s more to it than meets the eye! As you meet the challenges aerial or acrobatic training, you discover things about yourself that may surprise you! "
  image: "/assets/images/AELogoGreyBadge-sm.png"

intensive:
  title: "Intensive circus courses for 2026"
  body: "Full-time 1-year Professional Development course, 4-month Foundation courses & 4-week Intensives; part-time Pro-Track Programme & Rigging courses; plus an annual Easter festival"
  button:
    text: "Learn More"
    url: "/portfolio/full-time-pro-training/"
    target: "_blank"

works_section:
  small_title: "take a look"
  title: "Our classes & courses"
  intro: "Welcome to the fun side of life! Aerial Edge is an exciting and safe environment for you to explore a whole world of upside-down joy as you learn some very cool aerial and acrobatic skills. Check out each of the sections below for more details"
  tiles:
    - { work: "circus-fitness" }
    - { work: "aerial-edge-circus-challenge" }
    - { work: "youth-circus", style: "wide" }
    - { work: "aerial-acrobatic-arts" }
    - { work: "rigging-training" }
    - { work: "full-time-pro-training", style: "wide" }
    - { work: "parties-private-lessons" }
    - { work: "circus-cinematography" }

vouchers:
  title: "Gift Vouchers"
  body: "Give someone the gift of circus with one of our gift vouchers "
  image: "/assets/images/Gift-Voucher.jpg"
  button:
    text: "Buy a Voucher"
    url: "https://giftup.app/place-order/1eb2d8cf-004a-4a6a-9cb2-627691bf741e?platform=hosted"
    target: "_blank"

store:
  title: "Aerial Edge Clothing Store"
  body: "Keep someone warm with one of our cozy hoodies, or look at our circus training clothing line "
  image: "/assets/images/Hoodie1.jpg"
  button:
    text: "Buy a Hoodie"
    url: "https://store.aerialedge.co.uk/"
    target: "_blank"

# The five-item alternating band: video parallax, dark callout, video, callout, video.
# Order matters — preserved verbatim from pre-#210 hardcoded index.astro.
program_features:
  - kind: video
    small_title: "Acrobalance, Acrobatics & Trampolining"
    title_lines:
      - "Wednesdays & Thursdays"
      - "Come and learn with us! Classes are open to complete beginners, intermediate and advanced students of all ages."
    video_src: "/assets/images/videos/Acrobatics-no-title.mp4"
    button:
      text: "Book a class"
      url: "https://goteamup.com/p/3751555-aerial-edge/"
      target: "_blank"

  - kind: callout
    title: "Youth Circus places now available"
    body: "Class covers aerial arts, acrobatics, trampoline & juggling. Ages 1-7, 7-12 & 12-18. Term booking £12 per 90min class, drop-ins £20. Summer School 15-19 July & 5-9 August. "
    button:
      text: "Book Now"
      url: "https://goteamup.com/p/3751555-aerial-edge/"
      target: "_blank"

  - kind: video
    small_title: "Flying Trapeze Classes"
    title_lines:
      - "Mondays, Wednesdays, Fridays and Sundays"
      - "Come fly with us! Classes are open to complete beginners, intermediate and advanced students of all ages. Learn tricks on the bar, cradle tricks on the catcher and returns to platform. Maybe even star in one of our shows."
    video_src: "/assets/images/videos/Fly-trap-promo.mp4"
    button:
      text: "Book a class"
      url: "https://goteamup.com/p/3751555-aerial-edge/"
      target: "_blank"

  - kind: callout
    title: "Weekend workshops, parties and events"
    body: "Schedule private lessons, parties, team-building events or one of our weekend workshops."
    button:
      text: "Book Now"
      url: "https://goteamup.com/p/3751555-aerial-edge/"
      target: "_blank"

  - kind: video
    small_title: "Aerial Classes"
    title_lines:
      - "Weekdays and  weekends"
      - "Come and get upside down with us! Learn to perform exciting and different tricks and moves on aerial equipment including trapeze, hoop, silks (aka lyra), rope and more. Make your Instagram pop!"
    video_src: "/assets/images/videos/Aerials-no-titles.mp4"
    button:
      text: "Book a class"
      url: "https://goteamup.com/p/3751555-aerial-edge/"
      target: "_blank"

pricing:
  small_title: "Pricing"
  title: "Class pricing"
  cards:
    - title: "Circus fitness"
      icon: "fa fa-heart"
      price_tiers:
        - "£7.5 (8-class pass)"
        - "£8 (4-class pass)"
        - "£10 (drop-in)"
    - title: "Aerial"
      icon: "fa  fa-arrow-up"
      price_tiers:
        - "£17 (8-class pass)"
        - "£20 (4-class pass)"
        - "£25 (drop-in)"
    - title: "Acro"
      icon: "fa  fa-arrow-down"
      price_tiers:
        - "£12.50 (8-class pass)"
        - "£17.50 (4-class pass)"
        - "£20 (drop-in)"
    - title: "Youth circus"
      icon: "fa  fa-child"
      price_tiers:
        - "£12 (book the term)"
        - "£20 (drop-in)"

timetable:
  title: "Timetable"
  image: "/assets/images/timetable-jan.jpg"
  button:
    text: "Book a class"
    url: "https://goteamup.com/p/3751555-aerial-edge/"
    target: "_blank"

training_callout:
  title: "Training designed for you."
  body: "We can give you a personalised programme for your unique goals, abilities, time and budget. No charge. "
  button:
    text: "Learn More"
    url: "/portfolio/full-time-pro-training/"
    target: "_blank"
---
