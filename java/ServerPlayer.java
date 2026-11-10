package studio;

import java.awt.event.KeyEvent;
import java.awt.image.BufferedImage;
import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import javax.imageio.ImageIO;
import javax.microedition.midlet.MIDlet;

import org.microemu.DisplayAccess;
import org.microemu.DisplayComponent;
import org.microemu.EmulatorContext;
import org.microemu.MIDletAccess;
import org.microemu.MIDletBridge;
import org.microemu.MIDletContext;
import org.microemu.app.Common;
import org.microemu.app.ui.Message;
import org.microemu.app.ui.noui.NoUiDisplayComponent;
import org.microemu.app.ui.swing.SwingDeviceComponent;
import org.microemu.app.util.DeviceEntry;
import org.microemu.device.DeviceDisplay;
import org.microemu.device.FontManager;
import org.microemu.device.InputMethod;
import org.microemu.device.impl.DeviceImpl;
import org.microemu.device.j2se.J2SEDevice;
import org.microemu.device.j2se.J2SEDeviceDisplay;
import org.microemu.device.j2se.J2SEFontManager;
import org.microemu.device.j2se.J2SEInputMethod;
import org.microemu.device.j2se.J2SEMutableImage;
import org.microemu.log.Logger;

public final class ServerPlayer {
    private static final class FrameDisplay extends NoUiDisplayComponent {
        private boolean changed;

        FrameDisplay() {
            addDisplayRepaintListener(image -> changed = true);
        }

        @Override public synchronized void repaintRequest(int x, int y, int width, int height) {
            MIDletContext context = MIDletBridge.getMIDletContext();
            if (context != null && !context.isLauncher()) {
                super.repaintRequest(x, y, width, height);
            }
        }

        synchronized BufferedImage nextFrame() {
            if (!changed) return null;
            changed = false;
            BufferedImage source = (BufferedImage) ((J2SEMutableImage) getDisplayImage()).getImage();
            return new BufferedImage(source.getColorModel(), source.copyData(null), false, null);
        }
    }

    private static final class RestartingEmulator extends Common {
        private final AtomicReference<MIDlet> exited = new AtomicReference<>();
        private final AtomicReference<String> launchError;
        private long launchedAt;
        private int rapidRestarts;

        RestartingEmulator(EmulatorContext context, AtomicReference<String> launchError) {
            super(context);
            this.launchError = launchError;
        }

        void launch() {
            launchError.set(null);
            launchedAt = System.nanoTime();
            initMIDlet(true);
            String error = launchError.get();
            if (error != null) throw new IllegalArgumentException(error);
            MIDlet current = MIDletBridge.getCurrentMIDlet();
            if (!restartPending() && (current == null || current == getLauncher())) {
                throw new IllegalArgumentException("No MIDlet could be loaded from the JAR.");
            }
        }

        @Override public void notifyDestroyed(MIDletContext context) {
            if (context == null || context.isLauncher()) return;
            MIDlet previous = context.getMIDlet();
            if (previous == null || !exited.compareAndSet(null, previous)) return;

            // The bridge unregisters the MIDlet and closes its media after this callback.
            // Clean up its display here, without invoking Common's launcher transition.
            MIDletAccess access = context.getMIDletAccess();
            try {
                notifyImplementationMIDletDestroyed();
                DisplayAccess display = access.getDisplayAccess();
                if (display != null) display.clean();
            } catch (Throwable error) {
                Logger.error("Unable to clean up the exited MIDlet", error);
            } finally {
                access.setDisplayAccess(null);
            }
        }

        boolean restartPending() {
            return exited.get() != null;
        }

        synchronized boolean readyToRender() {
            MIDlet previous = exited.get();
            if (previous == null) return true;
            if (MIDletBridge.getMIDletContext(previous) != null) return false;

            if (System.nanoTime() - launchedAt >= TimeUnit.SECONDS.toNanos(2)) rapidRestarts = 0;
            if (++rapidRestarts > 3) {
                throw new IllegalStateException("MIDlet thoát liên tục khi khởi động lại.");
            }

            exited.set(null);
            launch();
            return !restartPending();
        }
    }

    public static void main(String[] args) {
        PrintStream protocol = System.out;
        // Keep game output and emulator logs out of the frame protocol.
        System.setOut(new PrintStream(new OutputStream() {
            @Override public void write(int value) {}
            @Override public void write(byte[] data, int offset, int length) {}
        }));

        try {
            run(args[0], args[1], args[2], protocol);
        } catch (Throwable error) {
            reportError(protocol, error);
            System.exit(1);
        }
        System.exit(0);
    }

    private static void reportError(PrintStream protocol, Throwable error) {
        protocol.println("ERROR " + Base64.getEncoder().encodeToString(
            error.toString().getBytes(StandardCharsets.UTF_8)));
    }

    private static void run(String midletPath, String width, String height, PrintStream protocol) throws Exception {
        FrameDisplay display = new FrameDisplay();
        EmulatorContext context = new EmulatorContext() {
            private final InputMethod input = new J2SEInputMethod();
            private final DeviceDisplay deviceDisplay = new J2SEDeviceDisplay(this);
            private final FontManager fonts = new J2SEFontManager();

            @Override public DisplayComponent getDisplayComponent() { return display; }
            @Override public InputMethod getDeviceInputMethod() { return input; }
            @Override public DeviceDisplay getDeviceDisplay() { return deviceDisplay; }
            @Override public FontManager getDeviceFontManager() { return fonts; }
            @Override public InputStream getResourceAsStream(String name) {
                return MIDletBridge.getCurrentMIDlet().getClass().getResourceAsStream(name);
            }
            @Override public boolean platformRequest(String url) { return false; }
        };

        AtomicReference<String> startupError = new AtomicReference<>();
        Message.addListener((level, title, message, cause) -> {
            if (level == Message.ERROR) startupError.compareAndSet(null, message);
        });

        org.microemu.cldc.http.Connection.setAllowNetworkConnection(false);
        DeviceEntry fallback = new DeviceEntry("Default", null, DeviceImpl.DEFAULT_LOCATION, true, false);
        RestartingEmulator emulator = new RestartingEmulator(context, startupError);
        emulator.initParams(new ArrayList<>(Arrays.asList(
            "--resizableDevice", width, height,
            "--rms", "memory", midletPath
        )), fallback, J2SEDevice.class);
        emulator.launch();

        ScheduledExecutorService encoder = Executors.newSingleThreadScheduledExecutor();
        encoder.scheduleAtFixedRate(() -> {
            try {
                if (!emulator.readyToRender()) return;
                BufferedImage frame = display.nextFrame();
                if (frame == null) return;
                ByteArrayOutputStream png = new ByteArrayOutputStream();
                ImageIO.write(frame, "png", png);
                protocol.println("FRAME " + Base64.getEncoder().encodeToString(png.toByteArray()));
            } catch (Throwable error) {
                reportError(protocol, error);
                encoder.shutdown();
            }
        }, 0, 67, TimeUnit.MILLISECONDS);

        try (BufferedReader input = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.US_ASCII))) {
            SwingDeviceComponent keys = new SwingDeviceComponent();
            String line;
            while ((line = input.readLine()) != null) {
                String[] parts = line.split(" ");
                if (parts.length != 3) continue;
                boolean pressed = "down".equals(parts[0]);
                KeyEvent event = new KeyEvent(keys, pressed ? KeyEvent.KEY_PRESSED : KeyEvent.KEY_RELEASED,
                    System.currentTimeMillis(), 0, Integer.parseInt(parts[1]), (char) Integer.parseInt(parts[2]));
                synchronized (emulator) {
                    if (emulator.restartPending()) continue;
                    if (pressed) keys.keyPressed(event);
                    else keys.keyReleased(event);
                }
            }
        } finally {
            encoder.shutdownNow();
            Common.dispose();
        }
    }
}
