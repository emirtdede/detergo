/**
 * Read RT_GROUP_ICON metadata from a Windows PE file.
 *
 * This is the release gate for the "NSIS drops a frame" class of bug: it counts
 * the frames actually embedded in the executable, not the frames in the source
 * ICO.
 */

const RT_ICON = 3;
const RT_GROUP_ICON = 14;

function u16(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function u32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function sectionTable(buffer) {
  if (buffer.toString("ascii", 0, 2) !== "MZ") throw new Error("not an MZ executable");
  const peOffset = u32(buffer, 0x3c);
  if (peOffset + 24 > buffer.length) throw new Error("PE header is out of bounds");
  if (buffer.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
    throw new Error("missing PE signature");
  }
  const coff = peOffset + 4;
  const numberOfSections = u16(buffer, coff + 2);
  const optionalSize = u16(buffer, coff + 16);
  const optional = coff + 20;
  const magic = u16(buffer, optional);
  const directoryOffset = magic === 0x20b ? 112 : magic === 0x10b ? 96 : null;
  if (directoryOffset === null)
    throw new Error(`unknown optional-header magic 0x${magic.toString(16)}`);
  const resourceRva = u32(buffer, optional + directoryOffset + 2 * 8);
  const resourceSize = u32(buffer, optional + directoryOffset + 2 * 8 + 4);
  const sections = [];
  const table = optional + optionalSize;
  for (let index = 0; index < numberOfSections; index += 1) {
    const entry = table + index * 40;
    if (entry + 40 > buffer.length) throw new Error("section table is truncated");
    sections.push({
      virtualAddress: u32(buffer, entry + 12),
      virtualSize: u32(buffer, entry + 8),
      rawSize: u32(buffer, entry + 16),
      rawPointer: u32(buffer, entry + 20),
    });
  }
  return { resourceRva, resourceSize, sections };
}

function rvaToOffset(pe, rva) {
  for (const section of pe.sections) {
    const span = Math.max(section.virtualSize, section.rawSize);
    if (rva >= section.virtualAddress && rva < section.virtualAddress + span) {
      return section.rawPointer + (rva - section.virtualAddress);
    }
  }
  throw new Error(`RVA 0x${rva.toString(16)} is not mapped by any section`);
}

function resourceEntries(buffer, pe, directoryOffset) {
  const base = rvaToOffset(pe, pe.resourceRva);
  const directory = base + directoryOffset;
  if (directory + 16 > buffer.length) throw new Error("resource directory is truncated");
  const named = u16(buffer, directory + 12);
  const ids = u16(buffer, directory + 14);
  const entries = [];
  for (let index = 0; index < named + ids; index += 1) {
    const entry = directory + 16 + index * 8;
    if (entry + 8 > buffer.length) throw new Error("resource entry is truncated");
    const nameField = u32(buffer, entry);
    const offsetField = u32(buffer, entry + 4);
    entries.push({
      id: nameField & 0x80000000 ? null : nameField,
      isDirectory: Boolean(offsetField & 0x80000000),
      offset: offsetField & 0x7fffffff,
    });
  }
  return { entries, base };
}

function resourceDataEntry(buffer, pe, offset) {
  const absolute = rvaToOffset(pe, pe.resourceRva) + offset;
  if (absolute + 16 > buffer.length) throw new Error("resource data entry is truncated");
  const dataRva = u32(buffer, absolute);
  const size = u32(buffer, absolute + 4);
  const fileOffset = rvaToOffset(pe, dataRva);
  if (fileOffset + size > buffer.length) throw new Error("resource data is out of bounds");
  return { fileOffset, size };
}

/**
 * @param {Buffer} buffer
 * @returns {{ groupIconCount: number, iconResourceCount: number, groupIcons: Array<{id:number, frames:number[]}> }}
 */
export function parsePeIcons(buffer) {
  const pe = sectionTable(buffer);
  if (pe.resourceRva === 0 || pe.resourceSize === 0) {
    throw new Error("PE has no resource directory");
  }

  const root = resourceEntries(buffer, pe, 0);
  const groupType = root.entries.find((entry) => entry.id === RT_GROUP_ICON && entry.isDirectory);
  const iconType = root.entries.find((entry) => entry.id === RT_ICON && entry.isDirectory);
  if (!groupType) throw new Error("PE has no RT_GROUP_ICON resource");

  const groupDirs = resourceEntries(buffer, pe, groupType.offset);
  const groupIcons = [];
  for (const group of groupDirs.entries) {
    if (!group.isDirectory) continue;
    const names = resourceEntries(buffer, pe, group.offset);
    for (const name of names.entries) {
      if (name.isDirectory) continue;
      const data = resourceDataEntry(buffer, pe, name.offset);
      if (data.size < 6) throw new Error("RT_GROUP_ICON data is truncated");
      const count = u16(buffer, data.fileOffset + 4);
      const frames = [];
      const expected = data.fileOffset + 6 + count * 14;
      if (expected > data.fileOffset + data.size)
        throw new Error("RT_GROUP_ICON frame table is truncated");
      for (let index = 0; index < count; index += 1) {
        const frame = data.fileOffset + 6 + index * 14;
        frames.push(u16(buffer, frame + 8)); // nID
      }
      groupIcons.push({ id: group.id, frames });
    }
  }

  let iconResourceCount = 0;
  if (iconType) {
    const iconDirs = resourceEntries(buffer, pe, iconType.offset);
    for (const icon of iconDirs.entries) {
      if (!icon.isDirectory) continue;
      const names = resourceEntries(buffer, pe, icon.offset);
      iconResourceCount += names.entries.filter((entry) => !entry.isDirectory).length;
    }
  }

  return { groupIconCount: groupIcons.length, iconResourceCount, groupIcons };
}
