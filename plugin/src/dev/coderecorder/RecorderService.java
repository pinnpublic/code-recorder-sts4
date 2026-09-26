package dev.coderecorder;

import java.io.*;
import java.nio.charset.Charset;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import org.eclipse.core.filebuffers.*;
import org.eclipse.core.resources.*;
import org.eclipse.core.runtime.*;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.jface.text.*;
import org.eclipse.swt.widgets.Display;
import org.eclipse.ui.*;
import org.eclipse.ui.part.MultiPageEditorPart;
import org.eclipse.ui.texteditor.ITextEditor;
import dev.coderecorder.core.Recording;

public final class RecorderService {
    public static final String DEFAULT_EXCLUDES = ".git,.settings,.metadata,.env,target,bin,build,node_modules,dist";
    public static final String EXTENSIONS = "java,jsp,jspx,xml,html,htm,css,js,ts,json,properties,yml,yaml,sql,txt,md,gradle";
    private static final int MAX_FILE = 2 * 1024 * 1024;
    private final Map<IDocument, Binding> bindings = new ConcurrentHashMap<>();
    private final Map<IFileBuffer, IDocument> bufferDocuments = new ConcurrentHashMap<>();
    private final Set<IWorkbenchWindow> windows = new HashSet<>();
    private final Set<String> warnings = ConcurrentHashMap.newKeySet();
    private volatile Recording recording;
    private volatile boolean accepting;
    private volatile boolean finishing;
    private IContainer root;
    private Set<String> excludes;
    private Set<String> extensions;
    private volatile String status = "프로젝트 또는 폴더를 선택하고 녹화를 시작하세요.";
    private Display display;
    private final ITextFileBufferManager buffers = FileBuffers.getTextFileBufferManager();

    public boolean isRecording() { return accepting; }
    public boolean isBusy() { return accepting || finishing; }
    public String status() {
        Recording r = recording;
        return status + (accepting && r != null ? "\n" + r.count() + "개 변경 기록" : "")
                + (warnings.isEmpty() ? "" : "\n제외/지원 확인 필요: " + String.join(", ", warnings));
    }
    public Recording recording() { return recording; }

    public void start(IContainer root, Path destination, String excluded, String supported) throws Exception {
        if (isBusy()) throw new IllegalStateException("녹화 또는 내보내기가 진행 중입니다.");
        if (!root.isAccessible() || root.getType() == IResource.ROOT) throw new IOException("열린 프로젝트나 폴더를 선택하세요.");
        recording = null;
        this.root = root; excludes = split(excluded); extensions = split(supported); warnings.clear();
        if (extensions.isEmpty()) throw new IOException("기록할 확장자를 하나 이상 입력하세요.");
        if (root.getLocation() != null && destination.toAbsolutePath().normalize().startsWith(root.getLocation().toFile().toPath().toAbsolutePath().normalize()))
            throw new IOException("녹화 파일은 기록 대상 폴더 밖에 저장하세요.");
        display = PlatformUI.getWorkbench().getDisplay();
        try {
            ResourcesPlugin.getWorkspace().run(monitor -> {
                try {
                    Map<String, String> initial = new LinkedHashMap<>();
                    Map<String, String> encodings = new LinkedHashMap<>();
                    long[] size = {0};
                    root.accept(resource -> {
                        if (resource != root && excluded(resource)) return false;
                        if (resource instanceof IFile && eligible((IFile) resource)) {
                            IFile f = (IFile) resource;
                            String text = read(f);
                            if (text != null) {
                                size[0] += text.length() * 2L;
                                if (size[0] > 64 * 1024 * 1024) throw new CoreException(new Status(IStatus.ERROR, "dev.coderecorder", "초기 텍스트가 64MB를 초과합니다. 대상 폴더를 줄이세요."));
                                initial.put(relative(f), text); encodings.put(relative(f), f.getCharset());
                            }
                        }
                        return true;
                    });
                    // Read dirty buffers before taking the baseline; never force a save.
                    for (IFileBuffer b : buffers.getFileBuffers()) attachBuffer(b);
                    for (IWorkbenchWindow w : PlatformUI.getWorkbench().getWorkbenchWindows()) {
                        for (IWorkbenchPage p : w.getPages()) for (IEditorReference ref : p.getEditorReferences()) attachEditor(ref.getEditor(false));
                    }
                    for (Binding b : bindings.values()) initial.put(relative(b.file), b.document.get());
                    recording = new Recording(destination, root.getFullPath().toPortableString(), initial, encodings, this::fail);
                    accepting = true;
                    buffers.addFileBufferListener(bufferListener);
                    ResourcesPlugin.getWorkspace().addResourceChangeListener(resources, IResourceChangeEvent.POST_CHANGE);
                    PlatformUI.getWorkbench().addWindowListener(windowListener);
                    PlatformUI.getWorkbench().addWorkbenchListener(workbenchListener);
                    for (IWorkbenchWindow w : PlatformUI.getWorkbench().getWorkbenchWindows()) listen(w);
                    status = "● 녹화 중 — " + root.getFullPath().toPortableString();
                } catch (Exception e) { throw new CoreException(new Status(IStatus.ERROR, "dev.coderecorder", e.getMessage(), e)); }
            }, ResourcesPlugin.getWorkspace().getRoot(), IWorkspace.AVOID_UPDATE, null);
        } catch (Exception e) {
            accepting = false; detach();
            if (recording != null) recording.finish();
            recording = null; throw e;
        }
    }

    private Set<String> split(String text) {
        Set<String> result = new HashSet<>();
        for (String item : text.split(",")) if (!item.trim().isEmpty()) result.add(item.trim().toLowerCase(Locale.ROOT));
        return result;
    }
    private String relative(IResource f) { return f.getFullPath().makeRelativeTo(root.getFullPath()).toPortableString(); }
    private boolean excluded(IResource f) {
        IPath p = f.getFullPath().makeRelativeTo(root.getFullPath());
        for (String segment : p.segments()) if (segment.startsWith(".") || excludes.contains(segment.toLowerCase(Locale.ROOT))) return true;
        return f.isDerived();
    }
    private boolean eligible(IFile f) {
        return root.getFullPath().isPrefixOf(f.getFullPath()) && !excluded(f)
                && f.getFileExtension() != null && extensions.contains(f.getFileExtension().toLowerCase(Locale.ROOT));
    }
    private String read(IFile file) throws CoreException {
        try (InputStream in = file.getContents()) {
            byte[] data = in.readNBytes(MAX_FILE + 1);
            if (data.length > MAX_FILE) { warnings.add(relative(file) + " (2MB 초과)"); return null; }
            String text = new String(data, Charset.forName(file.getCharset()));
            if (text.indexOf('\0') >= 0) { warnings.add(relative(file) + " (바이너리)"); return null; }
            return text;
        } catch (IOException | IllegalArgumentException e) {
            throw new CoreException(new Status(IStatus.ERROR, "dev.coderecorder", "읽기 실패: " + file.getFullPath(), e));
        }
    }
    private IFile bufferFile(IFileBuffer b) {
        if (b.getLocation() == null) return null;
        IResource f = ResourcesPlugin.getWorkspace().getRoot().findMember(b.getLocation());
        if (f instanceof IFile) return (IFile) f;
        return ResourcesPlugin.getWorkspace().getRoot().getFileForLocation(b.getLocation());
    }
    private void attachBuffer(IFileBuffer b) {
        IFile f = bufferFile(b);
        if (b instanceof ITextFileBuffer && f != null) {
            IDocument document = ((ITextFileBuffer) b).getDocument();
            if (document == null) return;
            attach(f, document);
            if (bindings.containsKey(document)) {
                IDocument old = bufferDocuments.put(b, document);
                if (old != null && old != document && !bufferDocuments.containsValue(old)) {
                    Binding binding = bindings.get(old); if (binding != null) release(binding);
                }
            }
        }
    }
    private void attach(IFile file, IDocument document) {
        if (document == null || !eligible(file) || bindings.containsKey(document)) return;
        if (document.getLength() > MAX_FILE) { warnings.add(relative(file) + " (문서 크기 초과)"); return; }
        Binding binding = new Binding(file, document);
        bindings.put(document, binding);
        if (accepting) recording.sync(relative(file), document.get(), "document-open");
        document.addDocumentListener(binding);
    }
    private void attachEditor(IEditorPart editor) {
        if (editor == null) return;
        IFile f = editor.getEditorInput().getAdapter(IFile.class);
        if (f == null || !eligible(f)) return;
        ITextEditor text = editor instanceof ITextEditor ? (ITextEditor) editor : editor.getAdapter(ITextEditor.class);
        if (text != null && text.getDocumentProvider() != null)
            attach(f, text.getDocumentProvider().getDocument(text.getEditorInput()));
        if (editor instanceof MultiPageEditorPart)
            for (IEditorPart child : ((MultiPageEditorPart) editor).findEditors(editor.getEditorInput())) attachEditor(child);
        if (accepting) {
            if (bindings.values().stream().noneMatch(b -> b.file.equals(f))) warnings.add(relative(f) + " (소스 탭을 열어 지원 확인)");
            else warnings.remove(relative(f) + " (소스 탭을 열어 지원 확인)");
        }
    }
    private void activate(IEditorPart editor) {
        if (!accepting || editor == null) return;
        attachEditor(editor);
        IFile f = editor.getEditorInput().getAdapter(IFile.class);
        if (f != null && eligible(f)) recording.activate(relative(f));
    }
    private void listen(IWorkbenchWindow window) {
        if (windows.add(window)) window.getPartService().addPartListener(parts);
        if (window.getActivePage() != null) activate(window.getActivePage().getActiveEditor());
    }
    private final IPartListener2 parts = new IPartListener2() {
        public void partActivated(IWorkbenchPartReference ref) { if (ref instanceof IEditorReference) activate(((IEditorReference) ref).getEditor(false)); }
        public void partOpened(IWorkbenchPartReference ref) { if (ref instanceof IEditorReference) attachEditor(((IEditorReference) ref).getEditor(false)); }
        public void partInputChanged(IWorkbenchPartReference ref) { partActivated(ref); }
        public void partClosed(IWorkbenchPartReference ref) {
            // Buffer disposal handles standard editors; release direct-only bindings afterwards.
            display.asyncExec(() -> {
                if (!accepting) return;
                for (Binding b : new ArrayList<>(bindings.values())) {
                    if (buffers.getTextFileBuffer(b.document) != null) continue;
                    boolean open = false;
                    for (IWorkbenchWindow w : windows) for (IWorkbenchPage p : w.getPages()) for (IEditorReference e : p.getEditorReferences()) {
                        IEditorPart editor = e.getEditor(false);
                        if (editor != null && b.file.equals(editor.getEditorInput().getAdapter(IFile.class))) open = true;
                    }
                    if (!open) release(b);
                }
            });
        }
    };
    private final IWindowListener windowListener = new IWindowListener() {
        public void windowOpened(IWorkbenchWindow w) { listen(w); }
        public void windowActivated(IWorkbenchWindow w) { listen(w); }
        public void windowDeactivated(IWorkbenchWindow w) {}
        public void windowClosed(IWorkbenchWindow w) { w.getPartService().removePartListener(parts); windows.remove(w); }
    };
    private final IWorkbenchListener workbenchListener = new IWorkbenchListener() {
        public boolean preShutdown(IWorkbench workbench, boolean forced) {
            if (accepting) {
                try { stop().get(15, TimeUnit.SECONDS); }
                catch (Exception error) { status = "종료 중 내보내기 실패 — journal 파일을 보관하세요: " + error.getMessage(); }
            }
            return true;
        }
        public void postShutdown(IWorkbench workbench) {}
    };
    private final IFileBufferListener bufferListener = new IFileBufferListener() {
        public void bufferCreated(IFileBuffer b) { if (accepting) attachBuffer(b); }
        public void bufferDisposed(IFileBuffer b) {
            IDocument document = bufferDocuments.remove(b);
            if (document != null && !bufferDocuments.containsValue(document)) {
                Binding binding = bindings.get(document); if (binding != null) release(binding);
            }
        }
        public void bufferContentAboutToBeReplaced(IFileBuffer b) {}
        public void bufferContentReplaced(IFileBuffer b) { if (accepting) attachBuffer(b); }
        public void stateChanging(IFileBuffer b) {}
        public void dirtyStateChanged(IFileBuffer b, boolean dirty) {}
        public void stateValidationChanged(IFileBuffer b, boolean validated) {}
        public void underlyingFileMoved(IFileBuffer b, IPath path) {
            if (!accepting || !(b instanceof ITextFileBuffer)) return;
            IDocument document = bufferDocuments.get(b);
            Binding binding = document == null ? null : bindings.get(document);
            if (binding != null) relocate(binding.file.getFullPath(), path);
        }
        public void underlyingFileDeleted(IFileBuffer b) {}
        public void stateChangeFailed(IFileBuffer b) {}
    };
    private final class Binding implements IDocumentListener {
        volatile IFile file;
        final IDocument document;
        Binding(IFile file, IDocument document) { this.file = file; this.document = document; }
        public void documentAboutToBeChanged(DocumentEvent event) {
            if (accepting && eligible(file)) {
                // Reconcile before the precise edit if an editor swapped/reloaded its document.
                recording.sync(relative(file), document.get(), "document-resync");
            }
        }
        public void documentChanged(DocumentEvent event) {
            if (!accepting || !eligible(file)) return;
            try {
                String path = relative(file), previous = recording.text(path);
                if (previous == null) recording.sync(path, document.get(), "document");
                else recording.edit(path, event.getOffset(), previous.substring(event.getOffset(), event.getOffset() + event.getLength()),
                        event.getText() == null ? "" : event.getText(), "document");
            } catch (Exception e) { fail(e); }
        }
    }
    private void release(Binding b) {
        b.document.removeDocumentListener(b); bindings.remove(b.document);
        if (accepting && eligible(b.file) && b.file.exists()) {
            try {
                Binding other = bindings.values().stream().filter(item -> item.file.equals(b.file)).findFirst().orElse(null);
                String text = other == null ? read(b.file) : other.document.get();
                if (text != null) recording.sync(relative(b.file), text, "document-close");
            }
            catch (CoreException e) { fail(e); }
        }
    }
    private void relocate(IPath from, IPath to) {
        if (!accepting) return;
        IWorkspaceRoot workspace = ResourcesPlugin.getWorkspace().getRoot();
        for (String path : recording.paths()) {
            IPath old = root.getFullPath().append(path);
            if (from.isPrefixOf(old)) {
                IPath target = to.append(old.makeRelativeTo(from));
                IFile newFile = workspace.getFile(target);
                if (eligible(newFile)) recording.move(path, relative(newFile)); else recording.delete(path);
            }
        }
        for (Binding b : bindings.values()) if (from.isPrefixOf(b.file.getFullPath()))
            b.file = workspace.getFile(to.append(b.file.getFullPath().makeRelativeTo(from)));
    }
    private final IResourceChangeListener resources = event -> {
        if (!accepting || event.getDelta() == null) return;
        try {
            // Process paired moves first, including directory moves, regardless of delta order.
            event.getDelta().accept(delta -> {
                if ((delta.getFlags() & IResourceDelta.MOVED_FROM) != 0) relocate(delta.getMovedFromPath(), delta.getFullPath());
                return true;
            });
            event.getDelta().accept(delta -> {
                if (!accepting) return false;
                IResource resource = delta.getResource();
                if (delta.getKind() == IResourceDelta.REMOVED) {
                    for (String path : recording.paths()) if (resource.getFullPath().isPrefixOf(root.getFullPath().append(path))) recording.delete(path);
                    return false;
                }
                if (resource instanceof IFile && eligible((IFile) resource)
                        && (delta.getKind() == IResourceDelta.ADDED || (delta.getFlags() & (IResourceDelta.CONTENT | IResourceDelta.REPLACED)) != 0)) {
                    IFile f = (IFile) resource;
                    // Tracked documents are authoritative, including unsaved content.
                    if (bindings.values().stream().noneMatch(b -> b.file.equals(f))) {
                        String text = read(f); if (text != null) recording.sync(relative(f), text, "resource");
                    }
                }
                return true;
            });
        } catch (Exception e) { fail(e); }
    };
    private void fail(Throwable error) {
        Recording current = recording;
        if (current != null) current.markFailed(error);
        status = "녹화 오류: " + error.getMessage();
        if (display != null && !display.isDisposed()) display.asyncExec(() -> {
            if (!accepting) return;
            stop();
            MessageDialog.openError(display.getActiveShell(), "Code Recorder", "녹화를 중단했습니다. 복구용 journal 파일을 보관하세요.\n" + error.getMessage());
        });
    }
    private void detach() {
        buffers.removeFileBufferListener(bufferListener);
        ResourcesPlugin.getWorkspace().removeResourceChangeListener(resources);
        PlatformUI.getWorkbench().removeWindowListener(windowListener);
        PlatformUI.getWorkbench().removeWorkbenchListener(workbenchListener);
        for (IWorkbenchWindow w : windows) w.getPartService().removePartListener(parts);
        windows.clear();
        for (Binding b : bindings.values()) b.document.removeDocumentListener(b);
        bindings.clear();
        bufferDocuments.clear();
    }
    public CompletableFuture<Path> stop() {
        if (!accepting) return CompletableFuture.failedFuture(new IllegalStateException("진행 중인 녹화가 없습니다."));
        accepting = false; finishing = true; detach(); status = "녹화 파일을 내보내는 중…";
        CompletableFuture<Path> future = recording.finish();
        future.whenComplete((path, error) -> {
            status = error == null ? "녹화 완료: " + path : "내보내기 실패 — journal 파일로 복구 가능: " + error.getMessage();
            finishing = false;
        });
        return future;
    }
    public void shutdown() {
        if (accepting) {
            try {
                if (display != null && !display.isDisposed() && Display.getCurrent() == null) display.syncExec(() -> stop());
                else stop();
            } catch (Exception ignored) { /* Journal is flushed after each event. */ }
        }
    }
}
