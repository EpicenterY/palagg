# PÅLÄGG

**3D printable models for IKEA SKÅDIS**

<br/>
<br/>
<p align="center"><img width="300" alt="part animation" src="https://github.com/user-attachments/assets/bc1bfe6e-2d24-4042-95d5-efc531b7d486"></p>

<p align="center"><a href="https://palagg.vercel.app">🔗 https://palagg.vercel.app</a></p>

<br/>
<br/>

[PÅLÄGG](https://palagg.vercel.app) (or simply, `palagg`) is a tool that generates 3d models compatible with IKEA's [SKÅDIS](https://www.ikea.com/ch/en/cat/skadis-series-37813/) pegboards.


The models can be customized and downloaded, and are meant to be then sliced and 3D printed (see [Printables page](https://www.printables.com/model/1133217-palagg-parametric-app-for-ikea-skadis-pegboard)).

PÅLÄGG is a **passion project**, not a commercial product of any kind! To learn about how it works and how it was built, read [this](https://nmattia.com/posts/2025-03-24-palagg-intro/).

### The name PÅLÄGG

The name PÅLÄGG reflects the "topping" concept of the app: allowing users to design and generate custom 3D-printable parts and boxes for IKEA SKÅDIS pegboards.

### Technology

The tool runs as a webapp, built with vanillajs, using [ThreeJS](https://threejs.org) and [vitejs](https://vite.dev). The models are generated using [manifold](https://github.com/elalish/manifold) and have a custom rendering pipeline to render outlines, aiming to look like an orthographic version of an IKEA manual.

## Using PÅLÄGG

### Print the models

Anyone with a 3D printer can download and print the physical parts.

1. Go to https://palagg.vercel.app,
1. Tweak the model to your liking,
1. Hit download and open the model in your favorite slicer,
1. Slice with 0.2mm layer height and no support material.

For more info, see the [Printables page](https://www.printables.com/model/1133217-palagg-parametric-app-for-ikea-skadis-pegboard).

### Build the app

The app uses [vitejs](https://vite.dev).

```
npm run dev # for development
npm run build # for production build
```

## Roadmap

The roadmap is not set in stone and is mostly a list of ideas I've had to extend PÅLÄGG.

* Go beyond SKÅDIS pegboards and add 3d-printable accessories for more IKEA products
* Advanced mode for customizable wall & bottom thickness
