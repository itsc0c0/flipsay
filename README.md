# FlipSay
Turn your flipper into an mini SDR! Meet FlipSay 🐬

This is FlipSay, an browser-based SDR interface for the Flipper Zero.
The idea was simple: what if your Flipper had a proper SDR frontend, like SDR# or GQRX, but running entirely in a webpage connected over USB? That’s what this is.

What it does: 

•Live spectrum analyzer with a real-time waterfall display. the waterfall actually scrolls and colors signal strength in that classic orange thermal style

•Full gain control. LNA, Mixer and IF gain stages, all draggable in real time •Sub-GHz RX/TX receive, raw record, and transmit directly from the UI using real Flipper CLI commands (subghz rx, subghz tx, subghz rx_raw)

•Frequency scanner sweeps across common bands (315, 433, 868, 915 MHz) automatically •Signal logger, detected signals get timestamped and saved, exportable as .txt •Demodulation settings: OOK, FSK, AM270, AM650, FM328, FM476 mode switching

•Everything is pixel art. the whole UI is styled like a retro SDR terminal, Press Start 2P font, chunky orange panels, CRT scanlines and all 

How it connects: It uses the WebSerial API (Chrome/Edge only) at 230400 baud the same baud rate Flipper uses for its CLI. No drivers, no Python, no qFlipper. Just plug in your Flipper, open the HTML file in Chrome, hit connect, and you’re in. 

Requirements:
• Any Flipper Zero firmware
• Google Chrome or Microsoft Edge (WebSerial API) 
• USB cable

The first beta-release is coming soon.
