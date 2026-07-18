(function initWeatherEffects(globalScope, factory) {
  const api = factory(globalScope);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.WinPlateWeatherEffects = api;
})(typeof window !== "undefined" ? window : globalThis, (globalScope) => {
  const activeEffects = new WeakMap();

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function readConfig(canvas) {
    return {
      scene: canvas.dataset.scene || "unknown",
      intensity: clamp(finite(canvas.dataset.intensity), 0, 1),
      cloudCover: clamp(finite(canvas.dataset.cloudCover, 50), 0, 100),
      windSpeed: clamp(finite(canvas.dataset.windSpeed), 0, 120),
      windDegrees: finite(canvas.dataset.windDegrees),
      humidity: clamp(finite(canvas.dataset.humidity, 50), 0, 100),
      visibility: clamp(finite(canvas.dataset.visibility, 20), 1, 50),
      haze: clamp(finite(canvas.dataset.haze), 0, 1)
    };
  }

  function effectSignature(canvas) {
    return ["scene", "intensity", "cloudCover", "windSpeed", "windDegrees", "humidity", "visibility", "haze"]
      .map((key) => canvas.dataset[key] || "")
      .join("|");
  }

  function resetParticle(particle, width, height, config, initial = false) {
    const rain = ["rain", "storm", "sleet"].includes(config.scene) && particle.kind !== "snow";
    particle.x = Math.random() * width;
    particle.y = initial ? Math.random() * height : -20 - Math.random() * height * .25;
    particle.alpha = .22 + Math.random() * .58;
    if (rain) {
      particle.length = 16 + Math.random() * 36 * (.45 + config.intensity);
      particle.speed = 360 + Math.random() * 520 * (.45 + config.intensity);
      particle.size = .7 + Math.random() * 1.25;
      return;
    }
    particle.radius = 1.4 + Math.random() * 3.8;
    particle.speed = 22 + Math.random() * 54 * (.55 + config.intensity);
    particle.phase = Math.random() * Math.PI * 2;
  }

  function createParticles(width, height, config) {
    let count = 0;
    if (["rain", "storm"].includes(config.scene)) count = Math.round(70 + config.intensity * 170);
    else if (config.scene === "sleet") count = Math.round(60 + config.intensity * 110);
    else if (["snow", "cold"].includes(config.scene)) count = Math.round(42 + config.intensity * 120);
    else if (["mist", "haze", "sand", "hot"].includes(config.scene)) count = Math.round(24 + Math.max(config.haze, config.intensity) * 70);
    return Array.from({ length: count }, (_, index) => {
      const particle = {
        kind: config.scene === "sleet" && index % 3 === 0
          ? "snow"
          : ["snow", "cold"].includes(config.scene)
            ? "snow"
            : ["mist", "haze", "sand", "hot"].includes(config.scene)
              ? "mote"
              : "rain"
      };
      resetParticle(particle, width, height, config, true);
      return particle;
    });
  }

  function createDroplets(width, height, config) {
    if (!["rain", "storm", "sleet"].includes(config.scene)) return [];
    return Array.from({ length: Math.round(8 + config.intensity * 28) }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: 1.5 + Math.random() * 5.5,
      speed: Math.random() < .22 ? 4 + Math.random() * 12 : 0,
      alpha: .08 + Math.random() * .18
    }));
  }

  function startEffect(canvas) {
    const context = canvas.getContext("2d", { alpha: true });
    const config = readConfig(canvas);
    const signature = effectSignature(canvas);
    const reducedMotion = globalScope.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
    let width = 1;
    let height = 1;
    let particles = [];
    let droplets = [];
    let frameId = 0;
    let lastFrame = 0;
    let visible = true;
    let destroyed = false;
    let nextFlash = 2800 + Math.random() * 4200;
    let flashStarted = -1000;

    const windRadians = config.windDegrees * Math.PI / 180;
    const windX = Math.sin(windRadians) * config.windSpeed * 4.2;

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, Math.round(bounds.width));
      height = Math.max(1, Math.round(bounds.height));
      const pixelRatio = Math.min(1.5, globalScope.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      particles = createParticles(width, height, config);
      droplets = createDroplets(width, height, config);
      render(0, 0);
    }

    function drawAtmosphere(time) {
      if (config.cloudCover > 55 && !["clear-night", "clear-day"].includes(config.scene)) {
        context.fillStyle = `rgba(55,72,88,${(config.cloudCover - 55) / 520})`;
        context.fillRect(0, 0, width, height);
      }
      if (["mist", "haze", "sand"].includes(config.scene)) {
        const density = Math.max(.18, config.haze);
        for (let band = 0; band < 4; band += 1) {
          const y = height * (.18 + band * .22) + Math.sin(time * .00018 + band) * 18;
          const gradient = context.createLinearGradient(0, y, width, y + 22);
          const warm = config.scene === "sand" ? "210,165,105" : config.scene === "haze" ? "205,190,160" : "225,235,240";
          gradient.addColorStop(0, `rgba(${warm},0)`);
          gradient.addColorStop(.5, `rgba(${warm},${.05 + density * .08})`);
          gradient.addColorStop(1, `rgba(${warm},0)`);
          context.fillStyle = gradient;
          context.fillRect(0, y, width, 38 + band * 8);
        }
      }
      if (config.scene === "storm" && time >= nextFlash) {
        flashStarted = time;
        nextFlash = time + 4200 + Math.random() * 6200;
      }
      const flashAge = time - flashStarted;
      if (flashAge >= 0 && flashAge < 190) {
        const strength = flashAge < 55 ? .19 : flashAge < 105 ? .05 : .12;
        context.fillStyle = `rgba(224,238,255,${strength})`;
        context.fillRect(0, 0, width, height);
      }
    }

    function drawParticles(deltaSeconds, time) {
      context.lineCap = "round";
      for (const particle of particles) {
        if (particle.kind === "rain") {
          particle.x += windX * deltaSeconds;
          particle.y += particle.speed * deltaSeconds;
          if (particle.y > height + particle.length || particle.x < -80 || particle.x > width + 80) {
            resetParticle(particle, width, height, config);
          }
          context.beginPath();
          context.moveTo(particle.x, particle.y);
          context.lineTo(particle.x - windX * .055, particle.y - particle.length);
          context.lineWidth = particle.size;
          context.strokeStyle = `rgba(220,238,248,${particle.alpha})`;
          context.stroke();
          continue;
        }
        if (particle.kind === "snow") {
          particle.phase += deltaSeconds * 1.5;
          particle.x += (windX * .2 + Math.sin(particle.phase) * 12) * deltaSeconds;
          particle.y += particle.speed * deltaSeconds;
          if (particle.y > height + 12 || particle.x < -24 || particle.x > width + 24) {
            resetParticle(particle, width, height, config);
          }
          context.beginPath();
          context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
          context.fillStyle = `rgba(246,250,255,${particle.alpha})`;
          context.fill();
          continue;
        }
        const speed = config.scene === "hot" ? -18 : 8;
        particle.x += (windX * .12 + 12) * deltaSeconds;
        particle.y += speed * deltaSeconds;
        if (particle.x > width + 20 || particle.y < -20 || particle.y > height + 20) {
          particle.x = -12;
          particle.y = Math.random() * height;
        }
        const alpha = (.03 + Math.max(config.haze, config.intensity) * .10) * particle.alpha;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.radius || 2, 0, Math.PI * 2);
        context.fillStyle = config.scene === "sand"
          ? `rgba(238,190,120,${alpha})`
          : `rgba(235,242,245,${alpha})`;
        context.fill();
      }
      if (["rain", "storm", "sleet"].includes(config.scene)) {
        for (const drop of droplets) {
          drop.y += drop.speed * deltaSeconds;
          if (drop.y > height + drop.radius) drop.y = -drop.radius;
          const gradient = context.createRadialGradient(
            drop.x - drop.radius * .35,
            drop.y - drop.radius * .4,
            .2,
            drop.x,
            drop.y,
            drop.radius
          );
          gradient.addColorStop(0, `rgba(255,255,255,${drop.alpha * 1.4})`);
          gradient.addColorStop(.35, `rgba(205,225,238,${drop.alpha * .28})`);
          gradient.addColorStop(1, "rgba(155,190,215,0)");
          context.fillStyle = gradient;
          context.beginPath();
          context.ellipse(drop.x, drop.y, drop.radius * .72, drop.radius, 0, 0, Math.PI * 2);
          context.fill();
        }
      }
      if (config.scene === "hot") {
        context.fillStyle = "rgba(255,210,160,.025)";
        for (let row = 0; row < 5; row += 1) {
          const y = height * (.25 + row * .15) + Math.sin(time * .001 + row) * 8;
          context.fillRect(0, y, width, 16);
        }
      }
    }

    function render(time, deltaSeconds) {
      context.clearRect(0, 0, width, height);
      drawAtmosphere(time);
      drawParticles(deltaSeconds, time);
    }

    function frame(time) {
      if (destroyed || !canvas.isConnected) {
        destroy();
        return;
      }
      if (visible && time - lastFrame >= 30) {
        const deltaSeconds = lastFrame ? Math.min(.05, (time - lastFrame) / 1000) : 0;
        lastFrame = time;
        render(time, reducedMotion ? 0 : deltaSeconds);
      }
      if (!reducedMotion) frameId = globalScope.requestAnimationFrame(frame);
    }

    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    const intersectionObserver = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => { visible = entries.some((entry) => entry.isIntersecting); })
      : null;
    resizeObserver?.observe(canvas);
    intersectionObserver?.observe(canvas);
    resize();
    if (!reducedMotion) frameId = globalScope.requestAnimationFrame(frame);

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frameId) globalScope.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      activeEffects.delete(canvas);
    }

    return { signature, destroy };
  }

  function mountWeatherEffects(root = globalScope.document) {
    root?.querySelectorAll?.("canvas.weather-scene-canvas").forEach((canvas) => {
      const signature = effectSignature(canvas);
      const active = activeEffects.get(canvas);
      if (active?.signature === signature) return;
      active?.destroy();
      activeEffects.set(canvas, startEffect(canvas));
    });
  }

  return { mountWeatherEffects };
});
