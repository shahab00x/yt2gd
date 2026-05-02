import { downloadFile } from '../server/services/downloader.js';

const url = "https://rr1---sn-vgqsrnde.googlevideo.com/videoplayback?expire=1777767788&ei=C0H2acvbPLmk0_wPzNvp2QU&ip=2602%3Af7a3%3A0%3A3900%3A%3A14&id=o-AHkQEgeNwTyGJgZlVPvyiToUzYkO-vkqKFUnY9Vn7MNp&itag=251&source=youtube&requiressl=yes&xpc=EgVo2aDSNQ%3D%3D&met=1777746188%2C&mh=Qk&mm=31%2C26&mn=sn-vgqsrnde%2Csn-p5qlsndz&ms=au%2Conr&mv=m&mvi=1&pl=49&rms=au%2Cau&initcwndbps=7660000&siu=1&bui=AbKmrwqwzBIEte8mV0UUUeOzw_1A9VxFBEoLPI8C7at0DPkdCfTfvvdGt-0Fsk7lQ6OV9i01kA&vprv=1&svpuc=1&xtags=drc%3D1&mime=audio%2Fwebm&ns=cM3ohI8FEqBu4a9r_LIF270U&rqh=1&gir=yes&clen=97436331&dur=6374.101&lmt=1777726620512307&mt=1777745820&fvip=1&keepalive=yes&lmw=1&fexp=51565116%2C51565681%2C51887892&c=TVHTML5&sefc=1&txp=5318224&n=irHN2jlwUjMiNg&sparams=expire%2Cei%2Cip%2Cid%2Citag%2Csource%2Crequiressl%2Cxpc%2Csiu%2Cbui%2Cvprv%2Csvpuc%2Cxtags%2Cmime%2Cns%2Crqh%2Cgir%2Cclen%2Cdur%2Clmt&sig=AHEqNM4wRQIhAORHzhgLey661mgGgKUJDOyHFfbL4OaCEFb3ffttoh7YAiBCkvuw2m77Y2JJQ1jEpu7RBexUFEInc13A341fS-PIuA%3D%3D&lsparams=met%2Cmh%2Cmm%2Cmn%2Cms%2Cmv%2Cmvi%2Cpl%2Crms%2Cinitcwndbps&lsig=APaTxxMwRgIhAOsZhcWZX__3Rll7R_wgHtAK-a204sfDFYdO0_hGkDKiAiEAo6yKQJW3oTGZB6WaasA8K6rVY50jc8wA79DKMgAgHkU%3D";

async function test() {
  console.log("Starting test download...");
  const start = Date.now();
  try {
    const filePath = await downloadFile(url);
    const end = Date.now();
    console.log(`Download finished in ${(end - start) / 1000} seconds.`);
  } catch (err) {
    console.error("Download failed:", err);
  }
}

test();
