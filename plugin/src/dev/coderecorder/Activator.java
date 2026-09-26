package dev.coderecorder;

import org.eclipse.ui.plugin.AbstractUIPlugin;
import org.osgi.framework.BundleContext;

public final class Activator extends AbstractUIPlugin {
    private static Activator instance;
    private RecorderService recorder;
    public void start(BundleContext context) throws Exception { super.start(context); instance = this; }
    public static Activator getDefault() { return instance; }
    public synchronized RecorderService recorder() {
        if (recorder == null) recorder = new RecorderService();
        return recorder;
    }
    public void stop(BundleContext context) throws Exception {
        try { if (recorder != null) recorder.shutdown(); }
        finally { instance = null; super.stop(context); }
    }
}
