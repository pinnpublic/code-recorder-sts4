package dev.coderecorder;

import java.nio.file.Paths;
import org.eclipse.core.resources.*;
import org.eclipse.core.runtime.IPath;
import org.eclipse.jface.dialogs.Dialog;
import org.eclipse.jface.dialogs.MessageDialog;
import org.eclipse.jface.preference.IPreferenceStore;
import org.eclipse.jface.window.Window;
import org.eclipse.swt.SWT;
import org.eclipse.swt.custom.ScrolledComposite;
import org.eclipse.swt.graphics.Image;
import org.eclipse.swt.graphics.ImageData;
import org.eclipse.swt.graphics.PaletteData;
import org.eclipse.swt.graphics.Point;
import org.eclipse.swt.layout.*;
import org.eclipse.swt.widgets.*;
import org.eclipse.ui.IEditorPart;
import org.eclipse.ui.dialogs.ContainerSelectionDialog;
import org.eclipse.ui.part.ViewPart;

public final class RecorderView extends ViewPart {
    public static final String ID = "dev.coderecorder.view";
    private static final String TARGET = "recorder.target", EXCLUDES = "recorder.excludes", EXTENSIONS = "recorder.extensions";
    private Text folder;
    private Label status, badge, badgeIcon;
    private Button start, stop, browse, settings;
    private RecorderService service;
    private IPreferenceStore preferences;
    private Image recordIcon, stopIcon, readyIcon;

    public void createPartControl(Composite parent) {
        service = Activator.getDefault().recorder();
        Display display = parent.getDisplay();
        recordIcon = shapeIcon(display, 0xFF6347, true);
        stopIcon = shapeIcon(display, 0x245BB2, false);
        readyIcon = shapeIcon(display, 0x7C8794, true);
        parent.addDisposeListener(e -> {
            recordIcon.dispose(); stopIcon.dispose(); readyIcon.dispose();
        });
        preferences = Activator.getDefault().getPreferenceStore();
        preferences.setDefault(EXCLUDES, RecorderService.DEFAULT_EXCLUDES);
        preferences.setDefault(EXTENSIONS, RecorderService.EXTENSIONS);
        parent.setLayout(new FillLayout());
        ScrolledComposite scroll = new ScrolledComposite(parent, SWT.V_SCROLL);
        scroll.setExpandHorizontal(true); scroll.setExpandVertical(true);
        Composite body = new Composite(scroll, SWT.NONE);
        GridLayout layout = new GridLayout(1, false);
        layout.marginWidth = 10; layout.marginHeight = 8; layout.verticalSpacing = 6;
        body.setLayout(layout); scroll.setContent(body);

        Composite target = new Composite(body, SWT.NONE);
        GridLayout targetLayout = new GridLayout(3, false);
        targetLayout.marginWidth = 0; targetLayout.marginHeight = 0;
        target.setLayout(targetLayout); target.setLayoutData(fill());
        new Label(target, SWT.NONE).setText("녹화 대상");
        folder = new Text(target, SWT.BORDER | SWT.READ_ONLY);
        GridData pathData = fill(); pathData.widthHint = 180; pathData.minimumWidth = 60;
        folder.setLayoutData(pathData);
        String saved = preferences.getString(TARGET);
        if (!saved.isEmpty() && ResourcesPlugin.getWorkspace().getRoot().findMember(saved) instanceof IContainer) {
            folder.setText(saved);
        } else {
            IEditorPart editor = getSite().getPage().getActiveEditor();
            IFile file = editor == null ? null : editor.getEditorInput().getAdapter(IFile.class);
            if (file != null) folder.setText(file.getProject().getFullPath().toPortableString());
        }
        browse = new Button(target, SWT.PUSH); browse.setText("변경…");
        browse.addListener(SWT.Selection, e -> {
            ContainerSelectionDialog dialog = new ContainerSelectionDialog(parent.getShell(),
                ResourcesPlugin.getWorkspace().getRoot(), false, "녹화할 프로젝트 또는 폴더를 선택하세요.");
            dialog.showClosedProjects(false);
            if (dialog.open() == Window.OK && dialog.getResult().length > 0) {
                folder.setText(((IPath) dialog.getResult()[0]).toPortableString());
                preferences.setValue(TARGET, folder.getText());
                update();
            }
        });

        Composite actions = new Composite(body, SWT.NONE);
        RowLayout row = new RowLayout(SWT.HORIZONTAL);
        row.marginLeft = row.marginRight = row.marginTop = row.marginBottom = 0;
        row.spacing = 6; row.center = true; row.wrap = true;
        actions.setLayout(row); actions.setLayoutData(fill());
        start = new Button(actions, SWT.PUSH); start.setText("녹화 시작"); start.setImage(recordIcon);
        stop = new Button(actions, SWT.PUSH); stop.setText("종료 / 내보내기"); stop.setImage(stopIcon);
        settings = new Button(actions, SWT.PUSH); settings.setText("설정…");
        settings.setToolTipText("제외할 폴더·파일 이름과 기록할 확장자를 설정합니다.");
        settings.addListener(SWT.Selection, e -> openSettings(parent.getShell()));
        Composite indicator = new Composite(actions, SWT.NONE);
        RowLayout indicatorLayout = new RowLayout(); indicatorLayout.center = true; indicatorLayout.wrap = false;
        indicatorLayout.marginLeft = indicatorLayout.marginRight = indicatorLayout.marginTop = indicatorLayout.marginBottom = 0;
        indicator.setLayout(indicatorLayout);
        badgeIcon = new Label(indicator, SWT.NONE);
        badge = new Label(indicator, SWT.NONE);
        status = new Label(body, SWT.NONE); status.setLayoutData(fill());
        status.setToolTipText("이 창을 닫거나 다른 탭으로 이동해도 녹화는 계속됩니다.");
        Runnable resize = () -> scroll.setMinSize(body.computeSize(Math.max(260, scroll.getClientArea().width), SWT.DEFAULT));
        scroll.addListener(SWT.Resize, e -> resize.run());
        start.addListener(SWT.Selection, e -> {
            IResource resource = folder.getText().isEmpty() ? null
                : ResourcesPlugin.getWorkspace().getRoot().findMember(folder.getText());
            if (!(resource instanceof IContainer)) {
                MessageDialog.openInformation(parent.getShell(), "Code Recorder", "녹화 대상을 선택하세요."); return;
            }
            FileDialog save = new FileDialog(parent.getShell(), SWT.SAVE);
            save.setText("녹화 파일 저장 위치 (대상 폴더 밖)");
            save.setFilterExtensions(new String[] { "*.coderec.json" });
            save.setFileName("sts4-" + resource.getProject().getName() + "-"
                + java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")) + ".coderec.json");
            String path = save.open(); if (path == null) return;
            try {
                preferences.setValue(TARGET, folder.getText());
                service.start((IContainer) resource, Paths.get(path), preferences.getString(EXCLUDES), preferences.getString(EXTENSIONS));
            } catch (Exception error) { MessageDialog.openError(parent.getShell(), "녹화 시작 실패", error.getMessage()); }
            update();
        });
        stop.addListener(SWT.Selection, e -> { service.stop(); update(); });
        Runnable timer = new Runnable() {
            public void run() {
                if (parent.isDisposed()) return;
                update(); resize.run(); parent.getDisplay().timerExec(500, this);
            }
        };
        timer.run();
    }

    private void openSettings(Shell shell) {
        new Dialog(shell) {
            private Text excluded, supported;
            protected boolean isResizable() { return true; }
            protected void configureShell(Shell dialogShell) { super.configureShell(dialogShell); dialogShell.setText("녹화 설정"); }
            protected Point getInitialSize() {
                Point size = getShell().computeSize(convertHorizontalDLUsToPixels(360), SWT.DEFAULT, true);
                getShell().setMinimumSize(size);
                return size;
            }
            protected Control createDialogArea(Composite parent) {
                Composite area = (Composite) super.createDialogArea(parent);
                Composite fields = new Composite(area, SWT.NONE);
                fields.setLayout(new GridLayout(1, false)); fields.setLayoutData(new GridData(SWT.FILL, SWT.FILL, true, true));
                new Label(fields, SWT.NONE).setText("제외할 폴더·파일 이름");
                excluded = new Text(fields, SWT.BORDER); excluded.setLayoutData(fill()); excluded.setText(preferences.getString(EXCLUDES));
                new Label(fields, SWT.NONE).setText("기록할 확장자");
                supported = new Text(fields, SWT.BORDER); supported.setLayoutData(fill()); supported.setText(preferences.getString(EXTENSIONS));
                new Label(fields, SWT.NONE).setText("쉼표로 구분합니다. 숨김 경로와 빌드 산출물은 제외됩니다.");
                return area;
            }
            protected void okPressed() {
                if (service.isBusy()) return;
                if (java.util.Arrays.stream(supported.getText().split(",")).allMatch(String::isBlank)) {
                    MessageDialog.openInformation(getShell(), "녹화 설정", "기록할 확장자를 하나 이상 입력하세요."); return;
                }
                preferences.setValue(EXCLUDES, excluded.getText());
                preferences.setValue(EXTENSIONS, supported.getText());
                super.okPressed();
            }
        }.open();
    }

    private void update() {
        start.setEnabled(!service.isBusy()); stop.setEnabled(service.isRecording());
        browse.setEnabled(!service.isBusy()); settings.setEnabled(!service.isBusy());
        folder.setToolTipText(folder.getText());
        String state = service.isRecording() ? "녹화 중" : service.isBusy() ? "내보내는 중" : "준비";
        String detail = service.status();
        String message = service.isRecording() ? detail.replace('\n', ' ') + " · 창을 닫아도 녹화가 계속됩니다."
            : detail.replace('\n', ' ');
        if (!message.equals(status.getText()) || !state.equals(badge.getText())) {
            status.setText(message); status.setToolTipText(detail);
            badge.setText(state);
            badgeIcon.setImage(service.isRecording() ? recordIcon : service.isBusy() ? stopIcon : readyIcon);
            badge.getParent().getParent().layout(true, true);
        }
    }
    private Image shapeIcon(Display display, int rgb, boolean circle) {
        ImageData data = new ImageData(14, 14, 24, new PaletteData(0xFF0000, 0x00FF00, 0x0000FF));
        for (int y = 0; y < 14; y++) for (int x = 0; x < 14; x++) {
            double coverage = circle ? Math.max(0, Math.min(1, 6 - Math.hypot(x - 6.5, y - 6.5)))
                : (x >= 2 && x < 12 && y >= 2 && y < 12 ? 1 : 0);
            data.setPixel(x, y, rgb); data.setAlpha(x, y, (int) Math.round(coverage * 255));
        }
        return new Image(display, data);
    }
    private GridData fill() { return new GridData(SWT.FILL, SWT.CENTER, true, false); }
    public void setFocus() { if (start != null) start.setFocus(); }
}
