package dev.coderecorder.tests;

import java.nio.file.Files;
import java.nio.file.Path;
import org.eclipse.ui.IStartup;
import org.eclipse.ui.PlatformUI;
import dev.coderecorder.RecorderView;

/** Runs only in the disposable installed IDE used by test-install.ps1. */
public final class StartupProbe implements IStartup {
    public void earlyStartup() {
        String result = System.getProperty("recorder.startup.result");
        if (result == null) return;
        PlatformUI.getWorkbench().getDisplay().asyncExec(() -> {
            try {
                var workbench = PlatformUI.getWorkbench();
                var window = workbench.getActiveWorkbenchWindow();
                window.getShell().setVisible(false);
                var view = window.getActivePage().showView(RecorderView.ID);
                if (!(view instanceof RecorderView)) throw new AssertionError("Recorder view did not open");
                Files.writeString(Path.of(result), "PASS: standard Eclipse IDE startup and installed recorder view; Java "
                    + System.getProperty("java.version"));
            } catch (Throwable error) {
                try { Files.writeString(Path.of(result + ".failure"), error.toString()); }
                catch (Exception ignored) { }
            } finally {
                PlatformUI.getWorkbench().close();
            }
        });
    }
}
