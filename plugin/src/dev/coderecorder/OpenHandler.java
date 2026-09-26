package dev.coderecorder;

import org.eclipse.core.commands.*;
import org.eclipse.ui.handlers.HandlerUtil;

public final class OpenHandler extends AbstractHandler {
    public Object execute(ExecutionEvent event) throws ExecutionException {
        try { HandlerUtil.getActiveWorkbenchWindowChecked(event).getActivePage().showView(RecorderView.ID); }
        catch (org.eclipse.ui.PartInitException e) { throw new ExecutionException("녹화 창을 열 수 없습니다.", e); }
        return null;
    }
}
