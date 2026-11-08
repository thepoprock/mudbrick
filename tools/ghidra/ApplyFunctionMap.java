// Apply Mudbrick's function map to your own analysed copy of civ2.exe.
// Arg0 = path to docs/functions/function-map.tsv. Renames each function and puts our
// description in its plate comment, so the listing and the decompiler show what each one does.
// Library and compiler names Ghidra already found are kept. Nothing from the game is in the map:
// the names and descriptions are Mudbrick's own words.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.CodeUnit;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.SourceType;
import java.io.BufferedReader;
import java.io.FileReader;

public class ApplyFunctionMap extends GhidraScript {
    @Override
    public void run() throws Exception {
        String path = getScriptArgs().length > 0 ? getScriptArgs()[0]
                : askFile("function-map.tsv", "Apply").getAbsolutePath();
        int renamed = 0, commented = 0, missing = 0, kept = 0;
        try (BufferedReader r = new BufferedReader(new FileReader(path))) {
            String line = r.readLine(); // header
            while ((line = r.readLine()) != null) {
                String[] p = line.split("\t", -1);
                if (p.length < 6) continue;
                Address a = toAddr(Long.parseLong(p[0], 16));
                Function f = getFunctionAt(a);
                if (f == null) { missing++; continue; }
                String name = p[2], system = p[3], basis = p[4], desc = p[5];
                boolean libraryName = basis.equals("ghidra-signature") || !f.getName().startsWith("FUN_");
                if (!libraryName && !name.isEmpty() && !name.startsWith("sub_")) {
                    try {
                        f.setName(name, SourceType.USER_DEFINED);
                        renamed++;
                    } catch (Exception e) {
                        printerr("could not rename " + p[0] + " to " + name + ": " + e.getMessage());
                    }
                } else {
                    kept++;
                }
                StringBuilder c = new StringBuilder();
                c.append("[").append(system).append("] ").append(desc);
                c.append("\nbasis: ").append(basis);
                if (p.length > 6 && !p[6].isEmpty()) c.append("\ndocs: ").append(p[6]);
                if (p.length > 7 && !p[7].isEmpty()) c.append("\nport: ").append(p[7]);
                f.setComment(c.toString());
                setPlateComment(a, c.toString());
                commented++;
            }
        }
        // The main game tables. Addresses from docs/engine/exe-notes.md (VERIFIED there), except
        // TextNumberArgs, which is INFERRED from the routines that fill it.
        String[][] tables = {
            {"5d12c0", "CivTable", "8 civilization records of 0x594 bytes (slot 0 barbarians); layout in docs/formats/save-format.md"},
            {"5d3f60", "CityTable", "city records of 0x58 bytes; count at CityCount"},
            {"5da738", "CityCount", "number of city records in use"},
            {"5dad10", "UnitTable", "unit records of 0x20 bytes"},
            {"5cfdd8", "UnitTypes", "62 unit type records of 20 bytes from RULES.TXT @UNITS"},
            {"5d08e8", "Cosmic", "the 22 @COSMIC values from RULES.TXT"},
            {"5c5308", "LabelHeap", "LABELS.TXT strings stored back to back; see GetLabel"},
            {"62e660", "MapWidth", "map width, as the bounds test MapInBounds uses it"},
            {"62e662", "MapHeight", "map height, as the bounds test MapInBounds uses it"},
            {"5c3e88", "TextNumberArgs", "the numbers popups show as %NUMBERn; see SetTextNumber"},
        };
        for (String[] t : tables) {
            Address a = toAddr(Long.parseLong(t[0], 16));
            createLabel(a, t[1], true, SourceType.USER_DEFINED);
            setPlateComment(a, t[2]);
        }
        println("ApplyFunctionMap: renamed " + renamed + ", kept " + kept + " existing names, commented "
                + commented + ", not found " + missing);
    }
}
