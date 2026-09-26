package dev.coderecorder.tests;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.eclipse.equinox.app.*;
import org.eclipse.core.resources.*;
import org.eclipse.core.runtime.IAdaptable;
import org.eclipse.core.filebuffers.*;
import org.eclipse.jface.text.IDocument;
import org.eclipse.swt.widgets.Display;
import org.eclipse.ui.*;
import org.eclipse.ui.application.*;
import org.eclipse.ui.ide.IDE;
import org.eclipse.ui.part.MultiPageEditorPart;
import org.eclipse.ui.texteditor.*;
import dev.coderecorder.*;
import dev.coderecorder.core.Json;

/** Opens real Eclipse editors in a separate workspace; never uses the teacher's workspace. */
public final class IntegrationApp implements IApplication {
    private Throwable failure;
    public Object start(IApplicationContext context) throws Exception {
        Display display = PlatformUI.createDisplay();
        Path output = Paths.get(System.getProperty("recorder.test.output"));
        // Do not let EGit attach the disposable project to this source tree's parent repository.
        org.eclipse.core.runtime.preferences.InstanceScope.INSTANCE.getNode("org.eclipse.egit.core")
            .putBoolean("core_autoShareProjects", false);
        // Disable unrelated dashboard/network startup extensions in this test workspace.
        StringJoiner disabled = new StringJoiner(";");
        for (org.eclipse.core.runtime.IConfigurationElement e : org.eclipse.core.runtime.Platform.getExtensionRegistry().getConfigurationElementsFor("org.eclipse.ui.startup"))
            disabled.add(e.getContributor().getName());
        PlatformUI.getPreferenceStore().setValue("PLUGINS_NOT_ACTIVATED_ON_STARTUP", disabled.toString());
        try {
            PlatformUI.createAndRunWorkbench(display, new WorkbenchAdvisor() {
                public String getInitialWindowPerspectiveId() { return "org.eclipse.ui.resourcePerspective"; }
                public IAdaptable getDefaultPageInput() { return ResourcesPlugin.getWorkspace().getRoot(); }
                public WorkbenchWindowAdvisor createWorkbenchWindowAdvisor(IWorkbenchWindowConfigurer config) {
                    return new WorkbenchWindowAdvisor(config) {
                        public void postWindowCreate() { config.getWindow().getShell().setLocation(-20000, -20000); }
                        public void postWindowOpen() { config.getWindow().getShell().setVisible(false); }
                    };
                }
                public void postStartup() {
                    display.asyncExec(() -> {
                        try { exercise(output); Files.writeString(output.resolve("PASS.txt"), "STS 4.32.2 / Eclipse 4.37 / Java " + System.getProperty("java.version") + "\nJava, JSP, Maven XML editors; unsaved edits, undo, save, move, create, delete, close/discard, export: PASS"); }
                        catch (Throwable e) {
                            failure = e;
                            try (PrintWriter out = new PrintWriter(Files.newBufferedWriter(output.resolve("FAIL.txt")))) { e.printStackTrace(out); }
                            catch (IOException ignored) {}
                            e.printStackTrace();
                        } finally {
                            for (IWorkbenchWindow w : PlatformUI.getWorkbench().getWorkbenchWindows())
                                for (IWorkbenchPage p : w.getPages()) p.closeAllEditors(false);
                            PlatformUI.getWorkbench().close();
                        }
                    });
                }
            });
        } finally { display.dispose(); }
        return failure == null ? EXIT_OK : Integer.valueOf(1);
    }
    private void exercise(Path output) throws Exception {
        List<Throwable> pluginErrors = new java.util.concurrent.CopyOnWriteArrayList<>();
        org.eclipse.core.runtime.ILogListener listener = (status, plugin) -> {
            Throwable cause = status.getException();
            while (cause != null) {
                for (StackTraceElement frame : cause.getStackTrace()) {
                    if (frame.getClassName().startsWith("dev.coderecorder.") && !frame.getClassName().startsWith("dev.coderecorder.tests.")) {
                        pluginErrors.add(cause); return;
                    }
                }
                cause = cause.getCause();
            }
        };
        org.eclipse.core.runtime.Platform.addLogListener(listener);
        IWorkspace workspace = ResourcesPlugin.getWorkspace();
        IWorkspaceDescription wd = workspace.getDescription(); wd.setAutoBuilding(false); workspace.setDescription(wd);
        IProject p = workspace.getRoot().getProject("recording-test"); p.create(null); p.open(null); p.setDefaultCharset("UTF-8", null);
        IProjectDescription pd = p.getDescription(); pd.setNatureIds(new String[]{"org.eclipse.jdt.core.javanature"}); p.setDescription(pd, null);
        IFile java = create(p, "Example.java", "public class Example {\r\n}\r\n");
        IFile jsp = create(p, "lesson.jsp", "<html><body>안녕😀</body></html>\r\n");
        IFile pom = create(p, "pom.xml", "<project xmlns=\"http://maven.apache.org/POM/4.0.0\"><modelVersion>4.0.0</modelVersion><groupId>test</groupId><artifactId>lesson</artifactId><version>1</version></project>\n");
        IFile discard = create(p, "discard.txt", "disk state\n");
        IWorkbenchPage page = PlatformUI.getWorkbench().getActiveWorkbenchWindow().getActivePage();
        IEditorPart javaEditor = IDE.openEditor(page, java, "org.eclipse.jdt.ui.CompilationUnitEditor", true);
        IDocument javaDoc = document(javaEditor, java);
        javaDoc.replace(0, 0, "// unsaved before start\r\n");
        page.showView(RecorderView.ID);
        RecorderService service = Activator.getDefault().recorder();
        service.start(p, output.resolve("integration.coderec.json"), RecorderService.DEFAULT_EXCLUDES, RecorderService.EXTENSIONS);
        Map<String, String> expected = new LinkedHashMap<>();
        try {
            page.activate(javaEditor);
            javaDoc.replace(javaDoc.getLength() - 3, 0, "  String message = \"한글🥳\";\r\n");
            check(javaDoc.get().equals(service.recording().text("Example.java")), "Java unsaved edit");
            long beforeSave = service.recording().count(); javaEditor.doSave(null);
            check(beforeSave == service.recording().count(), "save duplication");
            page.hideView(page.findView(RecorderView.ID));
            javaDoc.replace(0, 0, "// recorded with the panel closed\r\n");
            check(javaDoc.get().equals(service.recording().text("Example.java")), "recording with panel closed");
            page.showView(RecorderView.ID);
            check(service.isRecording(), "reopening the panel preserves the recording");

            // Spring Tools does not bundle WTP's JSP editor. Exercise its text editor.
            IEditorPart jspEditor = IDE.openEditor(page, jsp, "org.eclipse.ui.DefaultTextEditor", true);
            IDocument jspDoc = document(jspEditor, jsp);
            String before = jspDoc.get();
            jspDoc.replace(before.indexOf("안녕"), "안녕😀".length(), "복습🥳");
            check(jspDoc.get().equals(service.recording().text("lesson.jsp")), "JSP edit");
            ITextEditor textEditor = jspEditor.getAdapter(ITextEditor.class);
            if (textEditor == null && jspEditor instanceof ITextEditor) textEditor = (ITextEditor) jspEditor;
            check(textEditor != null && textEditor.getAction(ITextEditorActionConstants.UNDO) != null, "JSP undo action");
            textEditor.getAction(ITextEditorActionConstants.UNDO).run();
            check(before.equals(jspDoc.get()), "JSP undo result");
            check(before.equals(service.recording().text("lesson.jsp")), "JSP undo recording");

            IEditorPart pomEditor = IDE.openEditor(page, pom, "org.eclipse.m2e.editor.MavenPomEditor", true);
            if (pomEditor instanceof MultiPageEditorPart) {
                MultiPageEditorPart multi = (MultiPageEditorPart) pomEditor;
                for (IEditorPart child : multi.findEditors(pomEditor.getEditorInput())) if (child instanceof ITextEditor) multi.setActiveEditor(child);
            }
            IDocument pomDoc = document(pomEditor, pom);
            pomDoc.replace(pomDoc.get().indexOf("</project>"), 0, "<!-- unsaved XML -->");
            check(pomDoc.get().equals(service.recording().text("pom.xml")), "Maven XML unsaved edit");

            IEditorPart discardEditor = IDE.openEditor(page, discard);
            IDocument discardDoc = document(discardEditor, discard);
            discardDoc.replace(0, 0, "discard me\n");
            page.closeEditor(discardEditor, false);
            drain();
            check("disk state\n".equals(service.recording().text("discard.txt")), "discard on close");

            IFile external = create(p, "created.txt", "first\n");
            external.setContents(bytes("changed\n"), true, false, null);
            check("changed\n".equals(service.recording().text("created.txt")), "closed file change");
            external.move(p.getFullPath().append("renamed.txt"), true, null);
            check("changed\n".equals(service.recording().text("renamed.txt")), "rename");
            p.getFile("renamed.txt").delete(true, null);
            check(service.recording().text("renamed.txt") == null, "delete");

            java.move(p.getFullPath().append("Renamed.java"), true, null);
            drain();
            IFile renamedJava = p.getFile("Renamed.java");
            javaEditor = IDE.openEditor(page, renamedJava, "org.eclipse.jdt.ui.CompilationUnitEditor", true);
            javaDoc = document(javaEditor, renamedJava);
            javaDoc.replace(0, 0, "// edit after move\r\n");
            check(javaDoc.get().equals(service.recording().text("Renamed.java")), "open file edit after move");
            check(service.recording().text("Example.java") == null, "old path after move");

            expected.put("Renamed.java", javaDoc.get()); expected.put("lesson.jsp", jspDoc.get());
            expected.put("pom.xml", pomDoc.get()); expected.put("discard.txt", "disk state\n");
            Files.writeString(output.resolve("expected.json"), Json.encode(expected));
            service.stop().get(20, TimeUnit.SECONDS);
            check(Files.isRegularFile(output.resolve("integration.coderec.json")), "export");
            if (!pluginErrors.isEmpty()) throw new AssertionError("Recorder logged an exception", pluginErrors.get(0));
        } finally {
            org.eclipse.core.runtime.Platform.removeLogListener(listener);
            if (service.isRecording()) service.stop().get(20, TimeUnit.SECONDS);
        }
    }
    private void drain() { Display display = Display.getCurrent(); for (int i = 0; i < 100 && display.readAndDispatch(); i++) {} }
    private IFile create(IProject project, String name, String text) throws Exception { IFile f = project.getFile(name); f.create(bytes(text), true, null); return f; }
    private InputStream bytes(String text) { return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8)); }
    private IDocument document(IEditorPart editor, IFile file) throws Exception {
        ITextFileBuffer b = FileBuffers.getTextFileBufferManager().getTextFileBuffer(file.getFullPath(), LocationKind.IFILE);
        if (b != null) return b.getDocument();
        ITextEditor text = editor instanceof ITextEditor ? (ITextEditor) editor : editor.getAdapter(ITextEditor.class);
        if (text != null) return text.getDocumentProvider().getDocument(text.getEditorInput());
        throw new AssertionError("No text document: " + file + " / " + editor.getClass());
    }
    private void check(boolean condition, String label) { if (!condition) throw new AssertionError(label); }
    public void stop() { if (PlatformUI.isWorkbenchRunning()) PlatformUI.getWorkbench().getDisplay().asyncExec(() -> PlatformUI.getWorkbench().close()); }
}
