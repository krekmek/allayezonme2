import jsPDF from "jspdf";
import html2canvas from "html2canvas";

type AttendanceRow = {
  className: string;
  presentCount: number;
  absentCount: number;
  absentList: string[];
  portions: number;
  time: string;
};

export async function generateCanteenReport(
  rows: AttendanceRow[],
  totalPortions: number,
  date: Date
): Promise<void> {
  // Create a hidden HTML element to render the report
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-9999px";
  container.style.top = "0";
  container.style.width = "210mm";
  container.style.padding = "20mm";
  container.style.fontFamily = "Arial, sans-serif";
  container.style.backgroundColor = "#ffffff";
  container.style.color = "#000000";

  const dateStr = date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  container.innerHTML = `
    <div style="text-align: center; margin-bottom: 20px;">
      <h1 style="color: #805ad5; font-size: 24px; margin: 0;">Школа Aqbobek</h1>
      <p style="font-size: 12px; margin: 5px 0; color: #666;">Отчет по столовой</p>
      <p style="font-size: 10px; margin: 5px 0; color: #888;">Дата: ${dateStr}</p>
      <hr style="border: none; border-top: 1px solid #805ad5; margin: 15px 0;">
    </div>

    <div style="margin-bottom: 20px;">
      <h2 style="font-size: 14px; margin: 0 0 10px 0; color: #333;">Сводка</h2>
      <p style="font-size: 11px; margin: 5px 0; color: #666;">Всего отчётов: ${rows.length}</p>
      <p style="font-size: 11px; margin: 5px 0; color: #666;">Итого порций: ${totalPortions}</p>
    </div>

    <table style="width: 100%; border-collapse: collapse; font-size: 9px;">
      <thead>
        <tr style="background-color: #805ad5; color: white;">
          <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Время</th>
          <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Класс</th>
          <th style="padding: 8px; text-align: center; border: 1px solid #ddd;">Присутствует</th>
          <th style="padding: 8px; text-align: left; border: 1px solid #ddd;">Отсутствуют</th>
          <th style="padding: 8px; text-align: center; border: 1px solid #ddd;">Порций</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row, index) => `
          <tr style="${index % 2 === 0 ? 'background-color: #f5f0ff;' : ''}">
            <td style="padding: 6px; border: 1px solid #ddd;">${row.time}</td>
            <td style="padding: 6px; border: 1px solid #ddd;">${row.className}</td>
            <td style="padding: 6px; text-align: center; border: 1px solid #ddd;">${row.presentCount}</td>
            <td style="padding: 6px; border: 1px solid #ddd;">${row.absentList.join(", ") || "—"}</td>
            <td style="padding: 6px; text-align: center; border: 1px solid #ddd;">${row.portions}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>

    <div style="margin-top: 50px;">
      <hr style="border: none; border-top: 1px solid #805ad5; margin: 20px 0;">
      <div style="display: flex; justify-content: space-between; align-items: flex-end;">
        <div>
          <p style="font-size: 11px; margin: 0; color: #333; font-weight: bold;">Директор</p>
          <div style="border-bottom: 1px solid #999; width: 60px; margin: 10px 0;"></div>
          <p style="font-size: 9px; margin: 0; color: #666;">(подпись)</p>
        </div>
        <div style="text-align: center;">
          <div style="width: 60px; height: 60px; border: 2px solid #805ad5; border-radius: 50%; display: flex; flex-direction: column; justify-content: center; align-items: center;">
            <p style="font-size: 8px; margin: 0; color: #805ad5; font-weight: bold;">ПЕЧАТЬ</p>
            <p style="font-size: 6px; margin: 0; color: #805ad5;">Школа Aqbobek</p>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
    });

    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF("p", "mm", "a4");
    const imgWidth = 210;
    const pageHeight = 297;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
    const fileName = `canteen-report-${date.toISOString().split("T")[0]}.pdf`;
    pdf.save(fileName);
  } finally {
    document.body.removeChild(container);
  }
}
