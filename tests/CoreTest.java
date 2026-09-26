import dev.coderecorder.core.Recording;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.TimeUnit;

public final class CoreTest {
    public static void main(String[] args) throws Exception {
        Path folder = Paths.get(args[0]); Files.createDirectories(folder);
        Map<String, String> initial = new LinkedHashMap<>();
        initial.put("A.java", "class A {\r\n}\r\n"); initial.put("view.jsp", "<h1>안녕😀</h1>");
        Recording r = new Recording(folder.resolve("core.coderec.json"), "/lesson", initial, Collections.emptyMap(), e -> { throw new AssertionError(e); });
        r.activate("A.java");
        r.edit("A.java", 11, "", "  int count = 1;\r\n", "document");
        String changed = r.text("A.java");
        r.sync("A.java", changed, "save"); // Save must not duplicate an edit.
        if (r.count() != 2) throw new AssertionError("duplicate save");
        r.activate("view.jsp");
        r.edit("view.jsp", 4, "안녕😀", "복습🥳", "document");
        r.edit("view.jsp", 4, "복습🥳", "안녕😀", "document"); // Undo.
        r.move("view.jsp", "views/lesson.jsp");
        r.sync("new.txt", "\"quotes\"\t\\slash\n\ud83d", "resource");
        r.delete("new.txt");
        try { r.edit("A.java", 0, "wrong", "x", "document"); throw new AssertionError("bad patch accepted"); }
        catch (IllegalStateException expected) { }
        if (!changed.equals(r.text("A.java"))) throw new AssertionError("contents");
        r.finish().get(10, TimeUnit.SECONDS);
        System.out.println("PASS Java 21 recording, save deduplication, UTF-16, undo, move, delete, export");
    }
}
