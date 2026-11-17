# To do

Everything on the original list is built. What is left needs a person:

- [ ] Listen through the ten sound loops once (they were checked by
      measurement only). Chatter, dishes and street are the ones most likely
      to contain something distracting; fireplace repeats every 25 seconds.
      Swap any of them with `web/scripts/make-loop.sh`.
- [ ] Try it on a real iPhone: sound starting after the first tap, the
      per-channel volume sliders, dragging to-dos by touch, and notifications.
- [ ] Deploy: build the image on the NAS, attach it to the proxy network and
      copy `deploy/Caddyfile.example` (with the real hostname) into the Caddy
      config folder.
