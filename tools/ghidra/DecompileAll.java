// Decompile every function in the program into one file per function under the given folder.
import ghidra.app.decompiler.*;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.listing.*;
import java.io.*;

public class DecompileAll extends GhidraScript {
  @Override
  public void run() throws Exception {
    File dir = new File(getScriptArgs()[0]);
    dir.mkdirs();
    DecompInterface d = new DecompInterface();
    d.openProgram(currentProgram);
    int done = 0, failed = 0;
    FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
    while (it.hasNext()) {
      Function f = it.next();
      if (f.isThunk() || f.isExternal()) continue;
      String a = f.getEntryPoint().toString();
      File out = new File(dir, a + ".c");
      if (out.exists()) continue;
      DecompileResults r = d.decompileFunction(f, 60, monitor);
      if (r != null && r.getDecompiledFunction() != null) {
        try (PrintWriter w = new PrintWriter(out)) { w.print(r.getDecompiledFunction().getC()); }
        done++;
      } else failed++;
      if (done % 200 == 0) println("PROGRESS " + done + " failed " + failed);
    }
    println("DONE " + done + " failed " + failed);
  }
}
